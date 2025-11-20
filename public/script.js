// Global state
let currentJobs = [];
let historyJobs = [];
let autoRefreshInterval = null;
let currentSortColumn = null;
let currentSortDirection = 'asc';
let historySortColumn = null;
let historySortDirection = 'asc';
let currentJobId = null; // Track the currently viewed job in the modal
let jobDetailsCache = {}; // Cache job details data for faster tab switching

// Debug mode - enabled with ?debug=1 in URL
const DEBUG = new URLSearchParams(window.location.search).get('debug') === '1';

// Debug logging helper
function debugLog(message, data) {
    if (DEBUG) {
        console.log(`[JobApp Debug] ${message}`, data || '');
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    debugLog('App initializing...', { debug_mode: DEBUG });
    initializeEventListeners();
    loadAllData();
    setupAutoRefresh();
});

// Initialize event listeners
function initializeEventListeners() {
    // Setup job details modal tabs (only once)
    setupJobDetailsTabs();
    
    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
        loadAllData();
    });
    
    // Auto-refresh toggle
    document.getElementById('auto-refresh-toggle').addEventListener('change', (e) => {
        if (e.target.checked) {
            setupAutoRefresh();
        } else {
            clearInterval(autoRefreshInterval);
        }
    });
    
    // Current jobs filters
    document.getElementById('current-job-search').addEventListener('input', filterCurrentJobs);
    document.getElementById('current-job-filter').addEventListener('change', filterCurrentJobs);
    
    // History jobs filters
    document.getElementById('history-job-search').addEventListener('input', filterHistoryJobs);
    document.getElementById('history-state-filter').addEventListener('change', filterHistoryJobs);
    document.getElementById('history-days').addEventListener('change', () => {
        loadJobHistory();
    });
    
    // Table sorting - setup for both current and history tables
    document.querySelectorAll('#current-jobs-table [data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            sortCurrentJobs(th.dataset.sort);
        });
    });
    
    document.querySelectorAll('#history-jobs-table [data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            sortHistoryJobs(th.dataset.sort);
        });
    });
}

// Setup auto-refresh
function setupAutoRefresh() {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => {
        loadAllData();
    }, 30000); // 30 seconds
}

// Load all data
async function loadAllData() {
    showLoading(true);
    hideError();
    
    // Clear job details cache on refresh to ensure fresh data
    jobDetailsCache = {};
    debugLog('Cache cleared on refresh');
    
    try {
        await Promise.all([
            loadSummary(),
            loadCurrentJobs(),
            loadJobHistory()
        ]);
        updateLastUpdateTime();
    } catch (error) {
        showError('Failed to load data: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// Load job summary
async function loadSummary() {
    try {
        debugLog('Fetching job summary...');
        const response = await fetch(`${window.APP_BASE_PATH}/api/summary`);
        const result = await response.json();
        
        debugLog('Job summary response:', result);
        
        if (result.success) {
            debugLog('Summary stats:', result.data);
            updateSummaryStats(result.data);
        }
    } catch (error) {
        console.error('Failed to load summary:', error);
    }
}

// Load current jobs
async function loadCurrentJobs() {
    try {
        debugLog('Fetching current jobs...');
        const response = await fetch(`${window.APP_BASE_PATH}/api/current-jobs`);
        const result = await response.json();
        
        debugLog('Current jobs response:', result);
        
        if (result.success) {
            currentJobs = result.data;
            debugLog(`Loaded ${currentJobs.length} current jobs:`, currentJobs);
            
            // Log detailed info for first job if available
            if (DEBUG && currentJobs.length > 0) {
                console.log('[JobApp Debug] Sample current job:', currentJobs[0]);
            }
            
            renderCurrentJobs(currentJobs);
        }
    } catch (error) {
        console.error('Failed to load current jobs:', error);
        throw error;
    }
}

// Load job history
async function loadJobHistory() {
    try {
        const days = document.getElementById('history-days').value;
        debugLog(`Fetching job history (last ${days} days)...`);
        
        const response = await fetch(`${window.APP_BASE_PATH}/api/job-history?days=${days}`);
        const result = await response.json();
        
        debugLog('Job history response:', result);
        
        if (result.success) {
            historyJobs = result.data;
            debugLog(`Loaded ${historyJobs.length} historical jobs:`, historyJobs);
            
            // Log detailed info for first job if available
            if (DEBUG && historyJobs.length > 0) {
                console.log('[JobApp Debug] Sample history job:', historyJobs[0]);
            }
            
            renderHistoryJobs(historyJobs);
        }
    } catch (error) {
        console.error('Failed to load job history:', error);
        throw error;
    }
}

// Update summary stats
function updateSummaryStats(data) {
    document.getElementById('stat-total-jobs').textContent = data.total_jobs;
    document.getElementById('stat-running-jobs').textContent = data.running_jobs;
    document.getElementById('stat-pending-jobs').textContent = data.pending_jobs;
    document.getElementById('stat-gpus-used').textContent = data.total_gpus_used;
    document.getElementById('stat-cpus-used').textContent = `${data.total_cpus_used} CPUs used`;
}

// Render current jobs table
function renderCurrentJobs(jobs) {
    const tbody = document.getElementById('current-jobs-table-body');
    
    if (jobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted">No current jobs found</td></tr>';
        return;
    }
    
    tbody.innerHTML = jobs.map(job => `
        <tr>
            <td><strong>${escapeHtml(job.job_id)}</strong></td>
            <td>${escapeHtml(job.name)}</td>
            <td>${escapeHtml(job.partition)}</td>
            <td><span class="state-badge state-${job.state.toLowerCase()}">${job.state_name}</span></td>
            <td>${escapeHtml(job.time_used)}</td>
            <td>${escapeHtml(job.time_limit)}</td>
            <td>${job.nodes}</td>
            <td>${job.cpus}</td>
            <td>${job.gpus}</td>
            <td>${escapeHtml(job.node_list)}</td>
            <td>
                <button class="btn btn-info" onclick="showJobDetails('${escapeHtml(job.job_id)}')">
                    <i class="fas fa-info-circle"></i> Details
                </button>
            </td>
        </tr>
    `).join('');
}

// Render history jobs table
function renderHistoryJobs(jobs) {
    const tbody = document.getElementById('history-jobs-table-body');
    
    if (jobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted">No job history found for selected time period</td></tr>';
        return;
    }
    
    tbody.innerHTML = jobs.map(job => `
        <tr>
            <td><strong>${escapeHtml(job.job_id)}</strong></td>
            <td>${escapeHtml(job.name)}</td>
            <td>${escapeHtml(job.partition)}</td>
            <td><span class="state-badge state-${getStateClass(job.state)}">${escapeHtml(job.state)}</span></td>
            <td>${escapeHtml(job.elapsed)}</td>
            <td>${escapeHtml(job.start)}</td>
            <td>${escapeHtml(job.end)}</td>
            <td>${escapeHtml(job.max_rss)}</td>
            <td>${job.nodes}</td>
            <td>${job.cpus}</td>
            <td>${job.gpus || 0}</td>
            <td>
                <button class="btn btn-info" onclick="showJobDetails('${escapeHtml(job.job_id)}')">
                    <i class="fas fa-info-circle"></i> Details
                </button>
            </td>
        </tr>
    `).join('');
}

// Filter current jobs
function filterCurrentJobs() {
    const searchTerm = document.getElementById('current-job-search').value.toLowerCase();
    const stateFilter = document.getElementById('current-job-filter').value;
    
    const filtered = currentJobs.filter(job => {
        const matchesSearch = !searchTerm || 
            job.job_id.toLowerCase().includes(searchTerm) ||
            job.name.toLowerCase().includes(searchTerm) ||
            job.partition.toLowerCase().includes(searchTerm) ||
            job.node_list.toLowerCase().includes(searchTerm);
        
        const matchesState = stateFilter === 'all' || job.state === stateFilter;
        
        return matchesSearch && matchesState;
    });
    
    renderCurrentJobs(filtered);
}

// Filter history jobs
function filterHistoryJobs() {
    const searchTerm = document.getElementById('history-job-search').value.toLowerCase();
    const stateFilter = document.getElementById('history-state-filter').value;
    
    const filtered = historyJobs.filter(job => {
        const matchesSearch = !searchTerm || 
            job.job_id.toLowerCase().includes(searchTerm) ||
            job.name.toLowerCase().includes(searchTerm) ||
            job.partition.toLowerCase().includes(searchTerm) ||
            job.node_list.toLowerCase().includes(searchTerm);
        
        const matchesState = stateFilter === 'all' || job.state === stateFilter;
        
        return matchesSearch && matchesState;
    });
    
    renderHistoryJobs(filtered);
}

// Sort current jobs
function sortCurrentJobs(column) {
    if (currentSortColumn === column) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortColumn = column;
        currentSortDirection = 'asc';
    }
    
    currentJobs.sort((a, b) => {
        let aVal = a[column];
        let bVal = b[column];
        
        if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        }
        
        if (aVal < bVal) return currentSortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return currentSortDirection === 'asc' ? 1 : -1;
        return 0;
    });
    
    filterCurrentJobs();
}

// Sort history jobs
function sortHistoryJobs(column) {
    if (historySortColumn === column) {
        historySortDirection = historySortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        historySortColumn = column;
        historySortDirection = 'asc';
    }
    
    historyJobs.sort((a, b) => {
        let aVal = a[column];
        let bVal = b[column];
        
        if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        }
        
        if (aVal < bVal) return historySortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return historySortDirection === 'asc' ? 1 : -1;
        return 0;
    });
    
    filterHistoryJobs();
}

// Show job details modal
async function showJobDetails(jobid) {
    debugLog(`Opening job details modal for job: ${jobid}`);
    
    // Clear cache if switching to a different job
    if (currentJobId !== jobid) {
        jobDetailsCache = {};
        debugLog('Cache cleared - switched to different job');
    }
    
    // Set the current job ID globally
    currentJobId = jobid;
    
    const modal = document.getElementById('job-details-modal');
    const content = document.getElementById('job-details-content');
    
    modal.classList.remove('hidden');
    content.innerHTML = '<div class="text-center"><div class="spinner"></div></div>';
    
    // Reset to overview tab
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-tab="overview"]').classList.add('active');
    
    // Load overview tab by default
    await loadJobOverview(jobid);
}

// Close job details modal
function closeJobDetailsModal() {
    document.getElementById('job-details-modal').classList.add('hidden');
}

// Setup job details modal tabs (called once on initialization)
function setupJobDetailsTabs() {
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', async () => {
            // Update active tab
            document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Load appropriate content for the current job
            const tab = btn.dataset.tab;
            const content = document.getElementById('job-details-content');
            content.innerHTML = '<div class="text-center"><div class="spinner"></div></div>';
            
            // Use the global currentJobId instead of closure
            switch(tab) {
                case 'overview':
                    await loadJobOverview(currentJobId);
                    break;
                case 'efficiency':
                    await loadJobEfficiency(currentJobId);
                    break;
                case 'detailed':
                    await loadJobInfo(currentJobId);
                    break;
                case 'raw':
                    await loadJobRaw(currentJobId);
                    break;
            }
        });
    });
}

// Load job overview
async function loadJobOverview(jobid) {
    const cacheKey = `overview_${jobid}`;
    
    // Check cache first
    if (jobDetailsCache[cacheKey]) {
        debugLog(`Using cached overview for job: ${jobid}`);
        const details = jobDetailsCache[cacheKey];
        renderJobOverviewData(details);
        return;
    }
    
    try {
        debugLog(`Fetching job overview for job: ${jobid}`);
        
        const response = await fetch(`${window.APP_BASE_PATH}/api/job/${jobid}`);
        const result = await response.json();
        
        debugLog('Job overview response:', result);
        
        if (result.success) {
            const details = result.data;
            // Cache the data
            jobDetailsCache[cacheKey] = details;
            debugLog('Job details:', details);
            
            // Render the data
            renderJobOverviewData(details);
        } else {
            throw new Error(result.error || 'Failed to load job details');
        }
    } catch (error) {
        document.getElementById('job-details-content').innerHTML = 
            `<div class="error">Error loading job overview: ${escapeHtml(error.message)}</div>`;
    }
}

// Render job overview data (extracted for reusability)
function renderJobOverviewData(details) {
    const content = document.getElementById('job-details-content');
    
    // Build details HTML with conditional fields based on what's available
    let detailsHtml = `
                <p style="color: #666; font-size: 0.9rem; margin-bottom: 20px; padding: 10px; background: #f8f9fa; border-radius: 6px;">
                    <i class="fas fa-info-circle"></i> <strong>Job Info:</strong> Essential job metadata including times, resources, and locations
                </p>
                <div class="details-grid">
                <div class="detail-item">
                    <div class="detail-label">Job ID</div>
                    <div class="detail-value">${escapeHtml(details.job_id || 'N/A')}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Job Name</div>
                    <div class="detail-value">${escapeHtml(details.job_name || 'N/A')}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">User</div>
                    <div class="detail-value">${escapeHtml(details.user || 'N/A')}</div>
                </div>
                ${details.account ? `
                <div class="detail-item">
                    <div class="detail-label">Account</div>
                    <div class="detail-value">${escapeHtml(details.account)}</div>
                </div>
                ` : ''}
                <div class="detail-item">
                    <div class="detail-label">Partition</div>
                    <div class="detail-value">${escapeHtml(details.partition || 'N/A')}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">State</div>
                    <div class="detail-value"><span class="state-badge state-${getStateClass(details.state)}">${escapeHtml(details.state || 'N/A')}</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Submit Time</div>
                    <div class="detail-value">${escapeHtml(details.submit_time || 'N/A')}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Start Time</div>
                    <div class="detail-value">${escapeHtml(details.start_time || 'N/A')}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">End Time</div>
                    <div class="detail-value">${escapeHtml(details.end_time || 'N/A')}</div>
                </div>
                ${details.elapsed ? `
                <div class="detail-item">
                    <div class="detail-label">Elapsed Time</div>
                    <div class="detail-value">${escapeHtml(details.elapsed)}</div>
                </div>
                ` : ''}
                <div class="detail-item">
                    <div class="detail-label">Time Limit</div>
                    <div class="detail-value">${escapeHtml(details.time_limit || 'N/A')}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Nodes</div>
                    <div class="detail-value">${escapeHtml(details.nodes || 'N/A')}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">CPUs</div>
                    <div class="detail-value">${escapeHtml(details.cpus || 'N/A')}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">GPUs</div>
                    <div class="detail-value">${details.gpus || 0}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Node List</div>
                    <div class="detail-value">${escapeHtml(details.node_list || 'N/A')}</div>
                </div>
                ${details.req_mem ? `
                <div class="detail-item">
                    <div class="detail-label">Requested Memory</div>
                    <div class="detail-value">${escapeHtml(details.req_mem)}</div>
                </div>
                ` : ''}
                ${details.max_rss ? `
                <div class="detail-item">
                    <div class="detail-label">Max Memory Used</div>
                    <div class="detail-value">${escapeHtml(details.max_rss)}</div>
                </div>
                ` : ''}
                ${details.exit_code ? `
                <div class="detail-item">
                    <div class="detail-label">Exit Code</div>
                    <div class="detail-value">${escapeHtml(details.exit_code)}</div>
                </div>
                ` : ''}
                <div class="detail-item">
                    <div class="detail-label">Working Directory</div>
                    <div class="detail-value" style="word-break: break-all;">${escapeHtml(details.work_dir || 'N/A')}</div>
                </div>
                ${details.std_out ? `
                <div class="detail-item">
                    <div class="detail-label">Standard Output</div>
                    <div class="detail-value" style="word-break: break-all;">${escapeHtml(details.std_out)}</div>
                </div>
                ` : ''}
                ${details.std_err ? `
                <div class="detail-item">
                    <div class="detail-label">Standard Error</div>
                    <div class="detail-value" style="word-break: break-all;">${escapeHtml(details.std_err)}</div>
                </div>
                ` : ''}
                ${details.reason ? `
                <div class="detail-item" style="grid-column: 1 / -1;">
                    <div class="detail-label">Reason</div>
                    <div class="detail-value">${escapeHtml(details.reason)}</div>
                </div>
                ` : ''}
            </div>`;
    
    content.innerHTML = detailsHtml;
}

// Load job efficiency
async function loadJobEfficiency(jobid) {
    const cacheKey = `efficiency_${jobid}`;
    
    // Check cache first
    if (jobDetailsCache[cacheKey]) {
        debugLog(`Using cached efficiency for job: ${jobid}`);
        const eff = jobDetailsCache[cacheKey];
        renderJobEfficiencyData(eff);
        return;
    }
    
    try {
        debugLog(`Fetching job efficiency for job: ${jobid}`);
        
        const response = await fetch(`${window.APP_BASE_PATH}/api/job/${jobid}/efficiency`);
        const result = await response.json();
        
        debugLog('Job efficiency response:', result);
        
        if (result.success) {
            const eff = result.data;
            // Cache the data
            jobDetailsCache[cacheKey] = eff;
            debugLog('Job efficiency data:', eff);
            
            renderJobEfficiencyData(eff);
        } else {
            throw new Error(result.error || 'Failed to load efficiency data');
        }
    } catch (error) {
        document.getElementById('job-details-content').innerHTML = 
            `<div class="error">Error loading job efficiency: ${escapeHtml(error.message)}</div>`;
    }
}

// Render job efficiency data (extracted for reusability)
function renderJobEfficiencyData(eff) {
    const content = document.getElementById('job-details-content');
    
    content.innerHTML = `
                <p style="color: #666; font-size: 0.9rem; margin-bottom: 20px; padding: 10px; background: #f0f8ff; border-radius: 6px;">
                    <i class="fas fa-chart-line"></i> <strong>Resource Utilization:</strong> How efficiently your job used allocated CPU and memory (via <code>seff</code>)
                </p>
                <div class="details-grid">
                    <div class="detail-item">
                        <div class="detail-label">Job ID</div>
                        <div class="detail-value">${escapeHtml(eff.job_id || 'N/A')}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">State</div>
                        <div class="detail-value">${escapeHtml(eff.state || 'N/A')}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Cores</div>
                        <div class="detail-value">${eff.cores || 'N/A'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Wall-clock Time</div>
                        <div class="detail-value">${escapeHtml(eff.wallclock || 'N/A')}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">CPU Utilized</div>
                        <div class="detail-value">${escapeHtml(eff.cpu_utilized || 'N/A')}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">CPU Efficiency</div>
                        <div class="detail-value">${eff.cpu_efficiency ? eff.cpu_efficiency + '%' : 'N/A'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Memory Utilized</div>
                        <div class="detail-value">${escapeHtml(eff.memory_utilized || 'N/A')}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Memory Efficiency</div>
                        <div class="detail-value">${eff.memory_efficiency ? eff.memory_efficiency + '%' : 'N/A'}</div>
                    </div>
                </div>
                <div style="margin-top: 20px;">
                    <h3 style="margin-bottom: 15px;">Raw Output</h3>
                    <pre class="raw-output">${escapeHtml(eff.raw_output || 'No output available')}</pre>
                </div>
            `;
}

// Load job info (using jobinfo script)
async function loadJobInfo(jobid) {
    const cacheKey = `info_${jobid}`;
    
    // Check cache first
    if (jobDetailsCache[cacheKey]) {
        debugLog(`Using cached jobinfo for job: ${jobid}`);
        const info = jobDetailsCache[cacheKey];
        renderJobInfoData(info);
        return;
    }
    
    try {
        debugLog(`Fetching detailed job info (jobinfo) for job: ${jobid}`);
        
        const response = await fetch(`${window.APP_BASE_PATH}/api/job/${jobid}/info`);
        const result = await response.json();
        
        debugLog('Jobinfo response:', result);
        
        if (result.success) {
            const info = result.data;
            // Cache the data
            jobDetailsCache[cacheKey] = info;
            debugLog('Jobinfo data:', info);
            
            renderJobInfoData(info);
        } else {
            throw new Error(result.error || 'Failed to load job info');
        }
    } catch (error) {
        document.getElementById('job-details-content').innerHTML = 
            `<div class="error">Error loading job info: ${escapeHtml(error.message)}</div>`;
    }
}

// Render job info data (extracted for reusability)
function renderJobInfoData(info) {
    const content = document.getElementById('job-details-content');
    
    if (info.error) {
        content.innerHTML = `
            <p style="color: #666; font-size: 0.9rem; margin-bottom: 20px; padding: 10px; background: #fff3cd; border-radius: 6px;">
                <i class="fas fa-exclamation-triangle"></i> <strong>I/O & Performance:</strong> Detailed disk I/O and CPU breakdown analysis (via <code>jobinfo</code> script)
            </p>
            <div class="text-center text-muted">${escapeHtml(info.error)}</div>
        `;
        return;
    }
    
    let fieldsHtml = '';
    if (info.fields && Object.keys(info.fields).length > 0) {
        fieldsHtml = '<div class="details-grid">';
        for (const [key, value] of Object.entries(info.fields)) {
            fieldsHtml += `
                <div class="detail-item">
                    <div class="detail-label">${escapeHtml(key)}</div>
                    <div class="detail-value">${escapeHtml(value)}</div>
                </div>
            `;
        }
        fieldsHtml += '</div>';
    }
    
    content.innerHTML = `
        <p style="color: #666; font-size: 0.9rem; margin-bottom: 20px; padding: 10px; background: #e7f3ff; border-radius: 6px;">
            <i class="fas fa-tachometer-alt"></i> <strong>I/O & Performance:</strong> Disk I/O statistics and CPU time breakdown - shows if your job is I/O bound or compute bound (via <code>jobinfo</code> script)
        </p>
        ${fieldsHtml}
        <div style="margin-top: 20px;">
            <h3 style="margin-bottom: 15px;">Raw Output</h3>
            <pre class="raw-output">${escapeHtml(info.raw_output || 'No output available')}</pre>
        </div>
    `;
}

// Load raw job data
async function loadJobRaw(jobid) {
    const cacheKey = `raw_${jobid}`;
    
    // Check cache first (raw data is same as overview, so we can reuse it)
    if (jobDetailsCache[cacheKey] || jobDetailsCache[`overview_${jobid}`]) {
        debugLog(`Using cached raw data for job: ${jobid}`);
        const details = jobDetailsCache[cacheKey] || jobDetailsCache[`overview_${jobid}`];
        renderJobRawData(details);
        return;
    }
    
    try {
        debugLog(`Fetching raw job data for job: ${jobid}`);
        
        const response = await fetch(`${window.APP_BASE_PATH}/api/job/${jobid}`);
        const result = await response.json();
        
        debugLog('Raw job data response:', result);
        
        if (result.success) {
            const details = result.data;
            // Cache the data
            jobDetailsCache[cacheKey] = details;
            
            renderJobRawData(details);
        } else {
            throw new Error(result.error || 'Failed to load raw job data');
        }
    } catch (error) {
        document.getElementById('job-details-content').innerHTML = 
            `<div class="error">Error loading raw job data: ${escapeHtml(error.message)}</div>`;
    }
}

// Render raw job data (extracted for reusability)
function renderJobRawData(details) {
    const content = document.getElementById('job-details-content');
    
    const title = details.is_historical ? 'sacct -o ALL Output' : 'scontrol show jobid -dd Output';
    const commandInfo = details.is_historical 
        ? 'Complete historical job data from SLURM accounting database'
        : 'Real-time detailed information from SLURM controller';
    
    content.innerHTML = `
        <p style="color: #666; font-size: 0.9rem; margin-bottom: 20px; padding: 10px; background: #f8f9fa; border-radius: 6px;">
            <i class="fas fa-terminal"></i> <strong>Raw SLURM Data:</strong> ${commandInfo} - useful for debugging and advanced analysis
        </p>
        <h3 style="margin-bottom: 15px;">${title}</h3>
        <pre class="raw-output">${escapeHtml(details.raw_output || 'No output available')}</pre>
    `;
}

// Utility functions
function showLoading(show) {
    document.getElementById('loading-overlay').classList.toggle('hidden', !show);
}

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    document.getElementById('error-text').textContent = message;
    errorDiv.classList.remove('hidden');
}

function hideError() {
    document.getElementById('error-message').classList.add('hidden');
}

function updateLastUpdateTime() {
    const now = new Date();
    document.getElementById('last-update-time').textContent = now.toLocaleTimeString();
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = text.toString();
    return div.innerHTML;
}

function getStateClass(state) {
    if (!state) return 'unknown';
    const s = state.toLowerCase();
    if (s.includes('running') || s === 'r') return 'running';
    if (s.includes('pending') || s === 'pd') return 'pending';
    if (s.includes('completed') || s === 'cd') return 'completed';
    if (s.includes('failed') || s === 'f') return 'failed';
    if (s.includes('cancelled') || s === 'ca') return 'cancelled';
    if (s.includes('timeout') || s === 'to') return 'timeout';
    return 'unknown';
}

// Make functions globally accessible
window.showJobDetails = showJobDetails;
window.closeJobDetailsModal = closeJobDetailsModal;

