import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.cwd());
const companyBoardsPath = path.join(root, 'data', 'company-boards.json');
const outputPath = path.join(root, 'data', 'jobs.json');

const KEYWORDS = [
  'creative director',
  'art director',
  'brand designer',
  'graphic designer',
  'visual designer',
  'product designer',
  'ux designer',
  'ui designer',
  'ui/ux',
  'design systems',
  'motion designer',
  'motion graphics',
  'video editor',
  'editor',
  '3d designer',
  '3d artist',
  'cgi',
  'unreal',
  'houdini',
  'blender',
  'creative technologist',
  'design technologist',
  'web designer',
  'website designer',
  'front end designer',
  'front-end designer',
  'interactive designer',
  'digital designer',
  'experience designer',
  'spatial designer',
  'experiential designer',
  'ai designer',
  'prompt designer',
  'multimedia designer'
];

const CATEGORY_RULES = [
  {
    category: 'Creative Direction',
    match: ['creative director', 'art director']
  },
  {
    category: 'Motion Design',
    match: ['motion designer', 'motion graphics', 'video editor', 'editor', 'animation', 'after effects']
  },
  {
    category: '3D / Creative Technology',
    match: ['3d', 'cgi', 'unreal', 'houdini', 'blender', 'webgl', 'three.js', 'threejs']
  },
  {
    category: 'Creative Technology',
    match: ['creative technologist', 'design technologist', 'ai designer', 'prompt designer', 'interactive designer']
  },
  {
    category: 'Product Design',
    match: ['product designer', 'ux designer', 'ui designer', 'ui/ux', 'design systems', 'figma']
  },
  {
    category: 'Brand Design',
    match: ['brand designer', 'graphic designer', 'visual designer', 'digital designer', 'web designer', 'website designer']
  },
  {
    category: 'Spatial / Experiential',
    match: ['spatial designer', 'experiential designer', 'experience designer']
  }
];

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalizeText(...parts) {
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function titleFromSlug(slug) {
  return String(slug || '')
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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

function cleanSummary(text, maxLength = 240) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Role summary will be pulled from the source listing.';
  if (clean.length <= maxLength) return clean;

  const trimmed = clean.slice(0, maxLength);
  const lastSentenceBreak = Math.max(
    trimmed.lastIndexOf('. '),
    trimmed.lastIndexOf('; '),
    trimmed.lastIndexOf(': ')
  );

  return `${(lastSentenceBreak > 120 ? trimmed.slice(0, lastSentenceBreak + 1) : trimmed).trim()}…`;
}

function extractBullets(text) {
  const lines = String(text || '')
    .split(/\n+/)
    .map(line => line.replace(/^\s*[•\-*]+\s*/, '').trim())
    .filter(Boolean);

  const bullets = lines.filter(line => line.length > 18 && line.length < 220);
  return [...new Set(bullets)].slice(0, 6);
}

function inferCategory(job) {
  const haystack = normalizeText(job.title, job.description, ...(job.tags || []));
  for (const rule of CATEGORY_RULES) {
    if (rule.match.some(term => haystack.includes(term))) {
      return rule.category;
    }
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

function isRemoteSignal(...parts) {
  const text = normalizeText(...parts);
  return (
    text.includes('remote') ||
    text.includes('distributed') ||
    text.includes('work from home') ||
    text.includes('anywhere')
  );
}

function dedupe(jobs) {
  const priority = {
    'Direct company board': 3,
    'Selected market feed': 1
  };

  const map = new Map();

  for (const job of jobs) {
    const key = [
      slugify(job.company),
      slugify(job.title),
      slugify(job.location)
    ].join('::');

    const existing = map.get(key);

    if (!existing || (priority[job.source_type_label] || 0) > (priority[existing.source_type_label] || 0)) {
      map.set(key, job);
    }
  }

  return [...map.values()];
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'FCS-Careers/1.0 (+https://fitzgeraldcreativestudios.co.za)',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`Failed ${url}: ${response.status}`);
  }

  return response.json();
}

function normalizeBoardEntries(entries = []) {
  return entries.map(entry => {
    if (typeof entry === 'string') {
      return {
        slug: entry,
        company: titleFromSlug(entry),
        tier: 'curated'
      };
    }

    return {
      slug: entry.slug,
      company: entry.company || titleFromSlug(entry.slug),
      tier: entry.tier || 'curated'
    };
  });
}

async function fetchRemotive(enabledConfig) {
  if (!enabledConfig?.enabled) return [];

  const data = await fetchJson('https://remotive.com/api/remote-jobs?category=design');
  return (data.jobs || []).map(job => {
    const description = htmlToText(job.description || '');
    const responsibilities = extractBullets(description);
    const tier = enabledConfig.tier || 'expanded';

    return {
      id: `remotive-${job.id}`,
      tier,
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
      published_at: job.publication_date || null,
      posted_label: postedLabel(job.publication_date),
      listing_url: job.url,
      apply_url: job.url,
      summary: cleanSummary(description),
      description,
      responsibilities,
      source_note:
        'This role is distributed through Remotive and links back to the live source listing for the full application route.',
      tags: (job.tags || []).slice(0, 6)
    };
  });
}

async function fetchGreenhouseBoards(entries) {
  const boards = normalizeBoardEntries(entries);

  const results = await Promise.allSettled(
    boards.map(async board => {
      const data = await fetchJson(
        `https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs?content=true`
      );

      return (data.jobs || []).map(job => {
        const description = htmlToText(job.content || '');
        const responsibilities = extractBullets(description);
        const tags = [
          ...(job.departments || []).map(item => item.name),
          ...(job.offices || []).map(item => item.name)
        ].filter(Boolean);

        const location = job.location?.name || 'Multiple / Not stated';
        const remote = isRemoteSignal(location, description, ...tags);

        return {
          id: `greenhouse-${board.slug}-${job.id}`,
          tier: board.tier,
          source: 'greenhouse',
          source_label: 'Greenhouse',
          source_type_label: 'Direct company board',
          title: job.title,
          company: board.company,
          category: inferCategory({ title: job.title, description, tags }),
          location,
          work_model: remote ? 'Remote' : 'See listing',
          employment_type: 'Not stated',
          salary: 'Salary not stated',
          remote,
          published_at: job.updated_at || null,
          posted_label: postedLabel(job.updated_at),
          listing_url: job.absolute_url,
          apply_url: job.absolute_url,
          summary: cleanSummary(description),
          description,
          responsibilities,
          source_note:
            'This role is pulled from the company’s public Greenhouse board and links back to the original listing.',
          tags: [...new Set(tags)].slice(0, 6)
        };
      });
    })
  );

  return results.flatMap(result => (result.status === 'fulfilled' ? result.value : []));
}

async function fetchLeverBoards(entries) {
  const boards = normalizeBoardEntries(entries);

  const results = await Promise.allSettled(
    boards.map(async board => {
      const data = await fetchJson(`https://api.lever.co/v0/postings/${board.slug}?mode=json`);

      return (data || []).map(job => {
        const description = htmlToText(job.descriptionPlain || job.description || '');
        const responsibilities = extractBullets(description);
        const tags = [
          job.categories?.team,
          job.categories?.department,
          job.categories?.commitment
        ].filter(Boolean);

        const publishedAt = job.createdAt ? new Date(job.createdAt).toISOString() : null;
        const location = job.categories?.location || 'Multiple / Not stated';
        const commitment = job.categories?.commitment || 'Not stated';
        const remote = isRemoteSignal(location, commitment, description, ...tags);

        return {
          id: `lever-${board.slug}-${job.id}`,
          tier: board.tier,
          source: 'lever',
          source_label: 'Lever',
          source_type_label: 'Direct company board',
          title: job.text,
          company: board.company,
          category: inferCategory({ title: job.text, description, tags }),
          location,
          work_model: remote ? 'Remote' : 'See listing',
          employment_type: commitment,
          salary: 'Salary not stated',
          remote,
          published_at: publishedAt,
          posted_label: postedLabel(publishedAt),
          listing_url: job.hostedUrl || job.applyUrl,
          apply_url: job.applyUrl || job.hostedUrl,
          summary: cleanSummary(description),
          description,
          responsibilities,
          source_note:
            'This role is pulled from the company’s public Lever board and links back to the original listing.',
          tags: [...new Set(tags)].slice(0, 6)
        };
      });
    })
  );

  return results.flatMap(result => (result.status === 'fulfilled' ? result.value : []));
}

function coverageLabel(jobs) {
  const directCount = jobs.filter(job => job.source_type_label === 'Direct company board').length;
  const feedCount = jobs.filter(job => job.source_type_label === 'Selected market feed').length;

  if (directCount && feedCount) return 'Direct company boards + selected market feeds';
  if (directCount) return 'Direct company boards';
  if (feedCount) return 'Selected market feeds';
  return 'Current roles';
}

async function main() {
  const config = JSON.parse(await fs.readFile(companyBoardsPath, 'utf8'));

  const [greenhouseJobs, leverJobs, remotiveJobs] = await Promise.all([
    fetchGreenhouseBoards(config.greenhouse || []).catch(() => []),
    fetchLeverBoards(config.lever || []).catch(() => []),
    fetchRemotive(config.remotive || { enabled: false }).catch(() => [])
  ]);

  const jobs = dedupe([...greenhouseJobs, ...leverJobs, ...remotiveJobs])
    .filter(isRelevant)
    .sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));

  const payload = {
    generated_at: new Date().toISOString(),
    coverage_label: coverageLabel(jobs),
    total_jobs: jobs.length,
    curated_jobs: jobs.filter(job => job.tier === 'curated').length,
    expanded_jobs: jobs.filter(job => job.tier === 'expanded').length,
    jobs
  };

  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2));
  console.log(`Saved ${jobs.length} jobs to ${outputPath}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
