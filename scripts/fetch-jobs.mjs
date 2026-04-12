import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.cwd());
const companyBoardsPath = path.join(root, 'data', 'company-boards.json');
const outputPath = path.join(root, 'data', 'jobs.json');

const KEYWORDS = [
  'creative director', 'art director', 'brand designer', 'graphic designer', 'product designer',
  'motion designer', 'motion graphics', '3d designer', '3d artist', 'visual designer',
  'ux designer', 'ui designer', 'creative technologist', 'design technologist', 'website designer',
  'web designer', 'video editor', 'after effects', 'unreal', 'houdini', 'three.js', 'webgl',
  'ai designer', 'prompt designer', 'spatial', 'experiential', 'design system', 'visual design'
];

const CATEGORY_RULES = [
  { match: ['creative director', 'art director'], category: 'Creative Direction' },
  { match: ['product designer', 'ux', 'ui', 'design system', 'figma'], category: 'Product Design' },
  { match: ['motion', 'after effects', 'video editor', 'animation'], category: 'Motion Design' },
  { match: ['3d', 'unreal', 'houdini', 'webgl', 'three.js'], category: '3D / Creative Technology' },
  { match: ['brand', 'graphic', 'visual', 'website designer', 'web designer'], category: 'Brand Design' },
  { match: ['creative technologist', 'design technologist', 'ai designer', 'prompt', 'applied ai'], category: 'Creative Technology' }
];

function slugify(input) {
  return String(input).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function normalizeText(...parts) {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function decodeHtmlEntities(input) {
  return String(input || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function htmlToText(input) {
  return decodeHtmlEntities(String(input || ''))
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sentenceCaseSummary(text, maxLength = 220) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Role description to be populated from source.';
  if (clean.length <= maxLength) return clean;
  const trimmed = clean.slice(0, maxLength);
  const lastPunctuation = Math.max(trimmed.lastIndexOf('. '), trimmed.lastIndexOf('; '), trimmed.lastIndexOf(': '));
  return `${(lastPunctuation > 120 ? trimmed.slice(0, lastPunctuation + 1) : trimmed).trim()}…`;
}

function extractBullets(text) {
  const lines = String(text || '')
    .split(/\n+/)
    .map(line => line.replace(/^\s*[•\-*]+\s*/, '').trim())
    .filter(Boolean);
  const bullets = lines.filter(line => line.length > 24 && line.length < 220);
  return [...new Set(bullets)].slice(0, 5);
}

function inferCategory(job) {
  const haystack = normalizeText(job.title, job.description, ...(job.tags || []));
  for (const rule of CATEGORY_RULES) {
    if (rule.match.some(term => haystack.includes(term))) return rule.category;
  }
  return 'General';
}

function isRelevant(job) {
  const haystack = normalizeText(job.title, job.description, job.location, ...(job.tags || []));
  return KEYWORDS.some(term => haystack.includes(term));
}

function postedLabel(isoDate) {
  if (!isoDate) return 'Posted recently';
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return 'Posted recently';
  const days = Math.max(0, Math.floor((now - then) / 86400000));
  if (days === 0) return 'Posted today';
  if (days === 1) return 'Posted 1 day ago';
  if (days < 30) return `Posted ${days} days ago`;
  const months = Math.floor(days / 30);
  return `Posted ${months} month${months === 1 ? '' : 's'} ago`;
}

function dedupe(jobs) {
  const priority = { Greenhouse: 3, Lever: 3, Remotive: 1 };
  const map = new Map();
  for (const job of jobs) {
    const key = `${slugify(job.company)}::${slugify(job.title)}::${slugify(job.location)}`;
    const existing = map.get(key);
    if (!existing || (priority[job.source_label] || 0) > (priority[existing.source_label] || 0)) {
      map.set(key, job);
    }
  }
  return [...map.values()];
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'FCS-Careers/1.0 (+https://fitzgeraldcreativestudios.co.za)' }
  });
  if (!response.ok) throw new Error(`Failed ${url}: ${response.status}`);
  return response.json();
}

async function fetchRemotive() {
  const data = await fetchJson('https://remotive.com/api/remote-jobs?category=design');
  return (data.jobs || []).map(job => {
    const description = htmlToText(job.description || '');
    const responsibilities = extractBullets(description);
    return {
      id: `remotive-${job.id}`,
      source: 'remotive',
      source_label: 'Remotive',
      source_type_label: 'Selected market feed',
      title: job.title,
      company: job.company_name,
      category: inferCategory({ title: job.title, description, tags: job.tags || [] }),
      location: job.candidate_required_location || 'Remote',
      work_model: 'Remote',
      employment_type: job.job_type || 'Not stated',
      salary: job.salary || 'Salary not stated',
      remote: true,
      published_at: job.publication_date,
      posted_label: postedLabel(job.publication_date),
      listing_url: job.url,
      apply_url: job.url,
      summary: sentenceCaseSummary(description),
      responsibilities,
      source_note: 'This role is distributed through Remotive and links back to the live source page for the full posting and application route.',
      tags: (job.tags || []).slice(0, 6)
    };
  });
}

async function fetchGreenhouseBoards(boards) {
  const results = await Promise.allSettled(
    boards.map(async board => {
      const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
      return (data.jobs || []).map(job => {
        const description = htmlToText(job.content || '');
        const responsibilities = extractBullets(description);
        const tags = [
          ...(job.departments || []).map(item => item.name),
          ...(job.offices || []).map(item => item.name)
        ].filter(Boolean);
        return {
          id: `greenhouse-${board}-${job.id}`,
          source: 'greenhouse',
          source_label: 'Greenhouse',
          source_type_label: 'Direct company board',
          title: job.title,
          company: board,
          category: inferCategory({ title: job.title, description, tags }),
          location: job.location?.name || 'Multiple / Not stated',
          work_model: /remote/i.test(job.location?.name || description) ? 'Remote' : 'See listing',
          employment_type: 'Not stated',
          salary: 'Salary not stated',
          remote: /remote/i.test(job.location?.name || description),
          published_at: job.updated_at || null,
          posted_label: postedLabel(job.updated_at),
          listing_url: job.absolute_url,
          apply_url: job.absolute_url,
          summary: sentenceCaseSummary(description),
          responsibilities,
          source_note: 'This role is pulled from the company’s public Greenhouse board and links back to the original listing.',
          tags: [...new Set(tags)].slice(0, 6)
        };
      });
    })
  );
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}

async function fetchLeverBoards(boards) {
  const results = await Promise.allSettled(
    boards.map(async board => {
      const data = await fetchJson(`https://api.lever.co/v0/postings/${board}?mode=json`);
      return (data || []).map(job => {
        const description = htmlToText(job.descriptionPlain || job.description || '');
        const responsibilities = extractBullets(description);
        const tags = [job.categories?.team, job.categories?.department, job.categories?.commitment].filter(Boolean);
        const publishedAt = job.createdAt ? new Date(job.createdAt).toISOString() : null;
        const location = job.categories?.location || 'Multiple / Not stated';
        return {
          id: `lever-${board}-${job.id}`,
          source: 'lever',
          source_label: 'Lever',
          source_type_label: 'Direct company board',
          title: job.text,
          company: board,
          category: inferCategory({ title: job.text, description, tags }),
          location,
          work_model: /remote/i.test(location) ? 'Remote' : 'See listing',
          employment_type: job.categories?.commitment || 'Not stated',
          salary: 'Salary not stated',
          remote: /remote/i.test(location),
          published_at: publishedAt,
          posted_label: postedLabel(publishedAt),
          listing_url: job.hostedUrl || job.applyUrl,
          apply_url: job.applyUrl || job.hostedUrl,
          summary: sentenceCaseSummary(description),
          responsibilities,
          source_note: 'This role is pulled from the company’s public Lever board and links back to the original listing.',
          tags: [...new Set(tags)].slice(0, 6)
        };
      });
    })
  );
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}

function coverageLabel(jobs) {
  const hasDirect = jobs.some(job => ['Greenhouse', 'Lever'].includes(job.source_label));
  const hasFeed = jobs.some(job => job.source_label === 'Remotive');
  if (hasDirect && hasFeed) return 'Direct boards + selected feeds';
  if (hasDirect) return 'Direct company boards';
  if (hasFeed) return 'Selected market feeds';
  return 'Remote creative roles';
}

async function main() {
  const boards = JSON.parse(await fs.readFile(companyBoardsPath, 'utf8'));
  const [remotive, greenhouse, lever] = await Promise.all([
    fetchRemotive().catch(() => []),
    fetchGreenhouseBoards(boards.greenhouse || []).catch(() => []),
    fetchLeverBoards(boards.lever || []).catch(() => [])
  ]);

  const jobs = dedupe([...greenhouse, ...lever, ...remotive])
    .filter(isRelevant)
    .sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));

  const payload = {
    generated_at: new Date().toISOString(),
    coverage_label: coverageLabel(jobs),
    jobs
  };

  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2));
  console.log(`Saved ${jobs.length} jobs to ${outputPath}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
