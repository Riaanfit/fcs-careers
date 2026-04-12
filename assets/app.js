const state = {
  jobs: [],
  activeCategory: '',
};

const DIRECT_SOURCES = new Set(['Greenhouse', 'Lever']);

const els = {
  jobsGrid: document.getElementById('jobsGrid'),
  searchInput: document.getElementById('searchInput'),
  categoryFilter: document.getElementById('categoryFilter'),
  sourceFilter: document.getElementById('sourceFilter'),
  remoteOnly: document.getElementById('remoteOnly'),
  resultsMeta: document.getElementById('resultsMeta'),
  categories: document.getElementById('categories'),
  statCount: document.getElementById('stat-count'),
  statUpdated: document.getElementById('stat-updated'),
  statCoverage: document.getElementById('stat-coverage'),
  template: document.getElementById('jobCardTemplate')
};

function formatSnapshotDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

function normalizeText(v) {
  return String(v || '').toLowerCase().trim();
}

function escapeHtml(v) {
  return String(v || '').replace(/[&<>\"]/g, s => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[s]));
}

function sourceTier(job) {
  return job.source_type_label || (DIRECT_SOURCES.has(job.source_label) ? 'Direct company board' : 'Selected market feed');
}

function coverageLabel(jobs) {
  const hasDirect = jobs.some(job => DIRECT_SOURCES.has(job.source_label));
  const hasFeed = jobs.some(job => !DIRECT_SOURCES.has(job.source_label));
  if (hasDirect && hasFeed) return 'Direct boards + selected feeds';
  if (hasDirect) return 'Direct company boards';
  if (hasFeed) return 'Selected market feeds';
  return 'Remote creative roles';
}

function buildPills(categories) {
  const pills = ['All', ...categories];
  els.categories.innerHTML = '';
  pills.forEach(label => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `pill${(label === 'All' && !state.activeCategory) || state.activeCategory === label ? ' active' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      state.activeCategory = label === 'All' ? '' : label;
      els.categoryFilter.value = state.activeCategory;
      render();
    });
    els.categories.appendChild(btn);
  });
}

function setFilters(jobs) {
  const categories = [...new Set(jobs.map(job => job.category).filter(Boolean))].sort();
  const sources = [...new Set(jobs.map(job => job.source_label).filter(Boolean))].sort();

  buildPills(categories);

  els.categoryFilter.innerHTML = '<option value="">All disciplines</option>' + categories
    .map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)
    .join('');

  els.sourceFilter.innerHTML = '<option value="">All channels</option>' + sources
    .map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)
    .join('');
}

function filterJobs() {
  const q = normalizeText(els.searchInput.value);
  const category = els.categoryFilter.value || state.activeCategory;
  const source = els.sourceFilter.value;
  const remoteOnly = els.remoteOnly.checked;

  return state.jobs.filter(job => {
    const haystack = [
      job.title,
      job.company,
      job.category,
      job.location,
      job.salary,
      job.summary,
      ...(job.tags || []),
      ...(job.responsibilities || [])
    ].join(' ').toLowerCase();

    const matchesQuery = !q || haystack.includes(q);
    const matchesCategory = !category || job.category === category;
    const matchesSource = !source || job.source_label === source;
    const matchesRemote = !remoteOnly || job.remote === true;

    return matchesQuery && matchesCategory && matchesSource && matchesRemote;
  });
}

function render() {
  const filtered = filterJobs();
  const activeCategory = state.activeCategory || els.categoryFilter.value;

  [...els.categories.querySelectorAll('.pill')].forEach(pill => {
    const matches = (pill.textContent === 'All' && !activeCategory) || pill.textContent === activeCategory;
    pill.classList.toggle('active', matches);
  });

  els.jobsGrid.innerHTML = '';
  els.resultsMeta.textContent = `${filtered.length} current role${filtered.length === 1 ? '' : 's'}`;

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No roles match the current filters.';
    els.jobsGrid.appendChild(empty);
    return;
  }

  filtered.forEach(job => {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.querySelector('.job-source').textContent = `${sourceTier(job)} · ${job.source_label}`;
    node.querySelector('.job-title').textContent = job.title;
    node.querySelector('.job-company').textContent = job.company;
    node.querySelector('.job-category').textContent = job.category;

    const metaItems = [job.location, job.employment_type, job.posted_label].filter(Boolean);
    const meta = node.querySelector('.job-meta');
    meta.innerHTML = '';
    metaItems.forEach(item => {
      const chip = document.createElement('span');
      chip.textContent = item;
      meta.appendChild(chip);
    });

    node.querySelector('.job-summary').textContent = job.summary;

    const tags = node.querySelector('.job-tags');
    (job.tags || []).slice(0, 4).forEach(tag => {
      const chip = document.createElement('span');
      chip.textContent = tag;
      tags.appendChild(chip);
    });

    const detailLink = node.querySelector('.job-detail-link');
    detailLink.href = `./job.html?id=${encodeURIComponent(job.id)}`;

    const sourceLink = node.querySelector('.job-source-link');
    if (job.listing_url) {
      sourceLink.href = job.listing_url;
    } else {
      sourceLink.removeAttribute('href');
      sourceLink.classList.add('btn-disabled');
      sourceLink.textContent = 'Listing unavailable';
    }

    els.jobsGrid.appendChild(node);
  });
}

async function init() {
  const response = await fetch('./data/jobs.json', { cache: 'no-store' });
  const payload = await response.json();
  state.jobs = Array.isArray(payload.jobs) ? payload.jobs : [];

  els.statCount.textContent = String(state.jobs.length);
  els.statUpdated.textContent = payload.generated_at ? formatSnapshotDate(payload.generated_at) : '—';
  els.statCoverage.textContent = payload.coverage_label || coverageLabel(state.jobs);

  setFilters(state.jobs);
  render();

  els.searchInput.addEventListener('input', render);
  els.categoryFilter.addEventListener('change', () => {
    state.activeCategory = '';
    render();
  });
  els.sourceFilter.addEventListener('change', render);
  els.remoteOnly.addEventListener('change', render);
}

init().catch(err => {
  console.error(err);
  els.resultsMeta.textContent = 'Could not load roles.';
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = 'The role feed could not be loaded. Check that data/jobs.json is uploaded correctly.';
  els.jobsGrid.appendChild(empty);
});
