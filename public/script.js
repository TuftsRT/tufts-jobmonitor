// Global state
let currentJobs = [];
let historyJobs = [];
let autoRefreshInterval = null;
let currentSortColumn = null;
let currentSortDirection = 'asc';
let historySortColumn = 'start';
let historySortDirection = 'desc';
let currentJobId = null; // Track the currently viewed job in the modal
let jobDetailsCache = {}; // Cache job details data for faster tab switching

// Check if a value represents a missing/empty field
function isMissingValue(val) {
    if (val == null) return true;
    if (typeof val === 'string') {
        const lower = val.toLowerCase().trim();
        return lower === 'none' || lower === 'n/a' || lower === '';
    }
    return false;
}

// Debug mode - enabled with ?debug=1 in URL
const DEBUG = new URLSearchParams(window.location.search).get('debug') === '1';

// Debug logging helper
function debugLog(message, data) {
    if (DEBUG) {
        console.log(`[JobApp Debug] ${message}`, data || '');
    }
}

// Format date for datetime-local input
function formatDateTimeLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Toast notification with auto-dismiss
let toastDismissTimeout = null;

function showToast(message) {
    const toast = document.getElementById('toast-notification');
    const toastMessage = toast.querySelector('.toast-message');

    // Clear any existing timeout
    if (toastDismissTimeout) {
        clearTimeout(toastDismissTimeout);
    }

    // Show the toast
    toastMessage.textContent = message;
    toast.style.display = 'flex';

    // Auto-dismiss after 7 seconds
    toastDismissTimeout = setTimeout(() => {
        hideToast();
    }, 7000);
}

function hideToast() {
    const toast = document.getElementById('toast-notification');
    toast.style.display = 'none';

    if (toastDismissTimeout) {
        clearTimeout(toastDismissTimeout);
        toastDismissTimeout = null;
    }
}

// Apply custom date range with validation
function applyCustomDateRange() {
    const startInput = document.getElementById('history-start-date');
    const endInput = document.getElementById('history-end-date');

    const startDate = new Date(startInput.value);
    const endDate = new Date(endInput.value);

    // Validate dates
    if (!startInput.value || !endInput.value) {
        showToast('Please select both dates');
        return;
    }

    if (startDate >= endDate) {
        showToast('Start must be before end');
        return;
    }

    const maxRange = 31 * 24 * 60 * 60 * 1000; // 30 days + 1 day buffer
    if (endDate - startDate > maxRange) {
        showToast('Range cannot exceed 30 days');
        return;
    }

    // Hide any existing toast before loading
    hideToast();
    loadJobHistory();
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
        const value = document.getElementById('history-days').value;
        const customRangeDiv = document.getElementById('custom-date-range');

        if (value === 'custom') {
            customRangeDiv.style.display = 'flex';
            // Set default dates: end = now, start = 7 days ago
            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            document.getElementById('history-end-date').value = formatDateTimeLocal(now);
            document.getElementById('history-start-date').value = formatDateTimeLocal(sevenDaysAgo);
        } else {
            customRangeDiv.style.display = 'none';
            loadJobHistory();
        }
    });

    // Custom date range apply button
    document.getElementById('apply-custom-range').addEventListener('click', () => {
        applyCustomDateRange();
    });

    // Toast close button
    document.querySelector('#toast-notification .toast-close').addEventListener('click', () => {
        hideToast();
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
    }, 120000); // 120 seconds
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
            
            filterCurrentJobs();
        }
    } catch (error) {
        console.error('Failed to load current jobs:', error);
        throw error;
    }
}

// Load job history
async function loadJobHistory() {
    try {
        const daysSelect = document.getElementById('history-days').value;
        let url;

        if (daysSelect === 'custom') {
            const startDate = document.getElementById('history-start-date').value;
            const endDate = document.getElementById('history-end-date').value;
            debugLog(`Fetching job history (custom range: ${startDate} to ${endDate})...`);
            url = `${window.APP_BASE_PATH}/api/job-history?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`;
        } else {
            debugLog(`Fetching job history (last ${daysSelect} days)...`);
            url = `${window.APP_BASE_PATH}/api/job-history?days=${daysSelect}`;
        }

        const response = await fetch(url);
        const result = await response.json();

        debugLog('Job history response:', result);

        if (result.success) {
            historyJobs = result.data;
            debugLog(`Loaded ${historyJobs.length} historical jobs:`, historyJobs);

            // Log detailed info for first job if available
            if (DEBUG && historyJobs.length > 0) {
                console.log('[JobApp Debug] Sample history job:', historyJobs[0]);
            }

            // Apply current sort order (default: most recent first)
            if (historySortColumn) {
                historyJobs.sort((a, b) => {
                    let aVal = a[historySortColumn];
                    let bVal = b[historySortColumn];
                    // Push missing values (None, N/A) to the bottom
                    const aMissing = isMissingValue(aVal);
                    const bMissing = isMissingValue(bVal);
                    if (aMissing && bMissing) return 0;
                    if (aMissing) return 1;
                    if (bMissing) return -1;
                    if (typeof aVal === 'string') {
                        aVal = aVal.toLowerCase();
                        bVal = bVal.toLowerCase();
                    }
                    if (aVal < bVal) return historySortDirection === 'asc' ? -1 : 1;
                    if (aVal > bVal) return historySortDirection === 'asc' ? 1 : -1;
                    return 0;
                });
            }

            filterHistoryJobs();
        } else {
            // Show error to user if custom range validation failed
            if (result.error) {
                showToast(result.error);
            }
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
    debugLog('renderCurrentJobs called', {
        count: jobs.length,
        contains_user_limit_marker: renderCurrentJobs.toString().includes('user-limit-warning')
    });
    
    if (jobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted">No current jobs found</td></tr>';
        return;
    }
    
    tbody.innerHTML = jobs.map(job => {
        const warning = getUserLimitWarning(job);
        debugLog('Evaluating current job warning state', {
            job_id: job.job_id,
            state: job.state,
            reason: job.reason,
            warning_match: !!warning,
            warning_reason_code: warning ? warning.reasonCode : null
        });
        const stateLabel = job.state_name;
        return `
        <tr onclick="showJobDetails('${escapeHtml(job.job_id)}')" >
            <td><strong>${escapeHtml(job.job_id)}</strong></td>
            <td class="truncate-name" data-fullname="${escapeHtml(job.name)}">${escapeHtml(job.name)}</td>
            <td class="d-no-small" >${escapeHtml(job.partition)}</td>
            <td>
                <span class="state-badge state-${getStateClass(job.state)}">${escapeHtml(stateLabel)}</span>
                ${warning ? `<span class="user-limit-warning" data-tooltip="${escapeHtml(warning.tooltip)}" aria-label="${escapeHtml(warning.tooltip)}">
                        <span class="user-limit-warning-icon" aria-hidden="true">&#9888;</span>
                    </span>` : ''}
            </td>
            <td>${escapeHtml(job.time_used)}</td>
            <td>${escapeHtml(job.time_limit)}</td>
            <td class="d-no-small d-no-medium" >${job.nodes}</td>
            <td class="d-no-small d-no-medium" >${job.cpus}</td>
            <td class="d-no-small d-no-medium" >${job.gpus}</td>
            <td class="d-no-small" >${escapeHtml(job.node_list)}</td>
            <td>
                <button class="btn btn-info d-no-small" onclick="showJobDetails('${escapeHtml(job.job_id)}')">
                    <i class="fas fa-info-circle"></i> Details
                </button>
                <button class="btn btn-danger" onclick="deleteJob('${escapeHtml(job.job_id)}')">
                    <i class="fas fa-trash"></i> Cancel
                </button>
            </td>
        </tr>
    `;
    }).join('');
}

// Render history jobs table
function renderHistoryJobs(jobs) {
    const tbody = document.getElementById('history-jobs-table-body');
    
    if (jobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted">No job history found for selected time period</td></tr>';
        return;
    }
    
    tbody.innerHTML = jobs.map(job => `
        <tr  onclick="showJobDetails('${escapeHtml(job.job_id)}')" >
            <td><strong>${escapeHtml(job.job_id)}</strong></td>
            <td class="truncate-name" data-fullname="${escapeHtml(job.name)}">${escapeHtml(job.name)}</td>
            <td class="d-no-small" >${escapeHtml(job.partition)}</td>
            <td><span class="state-badge state-${getStateClass(job.state)}">${escapeHtml(job.state)}</span></td>
            <td>${escapeHtml(job.elapsed)}</td>
            <td>${escapeHtml(job.start.replace('T',' '))}</td>
            <td class="d-no-small" >${escapeHtml(job.end.replace('T',' '))}</td>
            <td class="d-no-small d-no-medium" >${escapeHtml(job.max_rss)}</td>
            <td class="d-no-small d-no-medium" >${job.nodes}</td>
            <td class="d-no-small d-no-medium" >${job.cpus}</td>
            <td class="d-no-small d-no-medium" >${job.gpus || 0}</td>
            <td class="d-no-small d-no-medium" >
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
        
        const matchesState = stateFilter === 'all' ||
            job.state.toUpperCase().startsWith(stateFilter.toUpperCase());

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
        
        const matchesState = stateFilter === 'all' ||
            job.state.toUpperCase().startsWith(stateFilter.toUpperCase());

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
        // Push missing values (None, N/A) to the bottom
        const aMissing = isMissingValue(aVal);
        const bMissing = isMissingValue(bVal);
        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;
        if (bMissing) return -1;
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
    
    // Reset to basic tab
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-tab="basic"]').classList.add('active');
    
    // Load basic info tab by default
    await loadBasicInfo(jobid);
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
                case 'basic':
                    await loadBasicInfo(currentJobId);
                    break;
                case 'resources':
                    await loadResourcesIO(currentJobId);
                    break;
                case 'script':
                    await loadJobScript(currentJobId);
                    break;
            }
        });
    });
}

// Load basic job information (Tab 1)
async function loadBasicInfo(jobid) {
    const cacheKey = `basic_${jobid}`;
    
    // Check cache first
    if (jobDetailsCache[cacheKey]) {
        debugLog(`Using cached basic info for job: ${jobid}`);
        renderBasicInfoData(jobDetailsCache[cacheKey]);
        return;
    }
    
    try {
        debugLog(`Fetching basic info for job: ${jobid}`);
        
        const response = await fetch(`${window.APP_BASE_PATH}/api/job/${jobid}`);
        const result = await response.json();
        
        debugLog('Basic info response:', result);
        
        if (result.success) {
            const details = result.data;
            jobDetailsCache[cacheKey] = details;
            renderBasicInfoData(details);
        } else {
            throw new Error(result.error || 'Failed to load job details');
        }
    } catch (error) {
        document.getElementById('job-details-content').innerHTML = 
            `<div class="error">Error loading job details: ${escapeHtml(error.message)}</div>`;
    }
}

// Render basic information (Tab 1)
function renderBasicInfoData(details) {
    const content = document.getElementById('job-details-content');
    
    content.innerHTML = `
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
                <div class="detail-label">Partition</div>
                <div class="detail-value">${escapeHtml(details.partition || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">QOS</div>
                <div class="detail-value">${escapeHtml(details.qos || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Nodes</div>
                <div class="detail-value">${escapeHtml(details.nodes || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Node List</div>
                <div class="detail-value">${escapeHtml(details.node_list || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">State</div>
                <div class="detail-value"><span class="state-badge state-${getStateClass(details.state)}">${escapeHtml(details.state || 'N/A')}</span></div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Exit Code</div>
                <div class="detail-value">${escapeHtml(details.exit_code || 'N/A')}</div>
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
            <div class="detail-item">
                <div class="detail-label">Elapsed Time</div>
                <div class="detail-value">${escapeHtml(details.elapsed || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Time Limit</div>
                <div class="detail-value">${escapeHtml(details.time_limit || 'N/A')}</div>
            </div>
        </div>`;
}

// Load computation resources and I/O (Tab 2)
async function loadResourcesIO(jobid) {
    const cacheKey = `resources_${jobid}`;
    
    // Check cache first
    if (jobDetailsCache[cacheKey]) {
        debugLog(`Using cached resources for job: ${jobid}`);
        renderResourcesIOData(jobDetailsCache[cacheKey]);
        return;
    }
    
    try {
        debugLog(`Fetching resources & I/O for job: ${jobid}`);
        
        // Fetch both efficiency (seff) and jobinfo data in parallel
        const [effResponse, infoResponse, detailsResponse] = await Promise.all([
            fetch(`${window.APP_BASE_PATH}/api/job/${jobid}/efficiency`),
            fetch(`${window.APP_BASE_PATH}/api/job/${jobid}/info`),
            fetch(`${window.APP_BASE_PATH}/api/job/${jobid}`)
        ]);
        
        const [effResult, infoResult, detailsResult] = await Promise.all([
            effResponse.json(),
            infoResponse.json(),
            detailsResponse.json()
        ]);
        
        // Combine the data
        const combinedData = {
            efficiency: effResult.success ? effResult.data : {},
            jobinfo: infoResult.success ? infoResult.data : {},
            details: detailsResult.success ? detailsResult.data : {}
        };
        
        jobDetailsCache[cacheKey] = combinedData;
        renderResourcesIOData(combinedData);
    } catch (error) {
        document.getElementById('job-details-content').innerHTML = 
            `<div class="error">Error loading resources & I/O: ${escapeHtml(error.message)}</div>`;
    }
}

// Render resources and I/O data (Tab 2)
function renderResourcesIOData(data) {
    const content = document.getElementById('job-details-content');
    const eff = data.efficiency || {};
    const info = data.jobinfo || {};
    const details = data.details || {};
    
    // Extract I/O fields from jobinfo if available
    const ioFields = info.fields || {};
    const maxDiskWrite = ioFields['Max Disk Write'] || ioFields['MaxDiskWrite'] || 'N/A';
    const maxDiskRead = ioFields['Max Disk Read'] || ioFields['MaxDiskRead'] || 'N/A';
    
    content.innerHTML = `
        <div class="details-grid">
            <div class="detail-item">
                <div class="detail-label">CPUs</div>
                <div class="detail-value">${escapeHtml(details.cpus || eff.cores || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">GPUs</div>
                <div class="detail-value">${details.gpus || 0}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">GPU Model</div>
                <div class="detail-value">${escapeHtml(details.gpu_model || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Requested Memory</div>
                <div class="detail-value">${escapeHtml(details.req_mem || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">CPU Efficiency</div>
                <div class="detail-value">${eff.cpu_efficiency ? eff.cpu_efficiency + '%' : 'N/A'}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Memory Efficiency</div>
                <div class="detail-value">${eff.memory_efficiency ? eff.memory_efficiency + '%' : 'N/A'}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Max Memory Used</div>
                <div class="detail-value">${escapeHtml(eff.memory_utilized || details.max_rss || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Max Disk Write</div>
                <div class="detail-value">${escapeHtml(maxDiskWrite)}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Max Disk Read</div>
                <div class="detail-value">${escapeHtml(maxDiskRead)}</div>
            </div>
        </div>`;
}

// Load job script (Tab 3)
async function loadJobScript(jobid) {
    const cacheKey = `script_${jobid}`;
    
    // Check cache first
    if (jobDetailsCache[cacheKey]) {
        debugLog(`Using cached script for job: ${jobid}`);
        renderJobScriptData(jobDetailsCache[cacheKey]);
        return;
    }
    
    try {
        debugLog(`Fetching job script for job: ${jobid}`);
        
        const response = await fetch(`${window.APP_BASE_PATH}/api/job/${jobid}/script`);
        const result = await response.json();
        
        debugLog('Job script response:', result);
        
        if (result.success) {
            jobDetailsCache[cacheKey] = result.data;
            renderJobScriptData(result.data);
        } else {
            throw new Error(result.error || 'Failed to load job script');
        }
    } catch (error) {
        document.getElementById('job-details-content').innerHTML = 
            `<div class="error">Error loading job script: ${escapeHtml(error.message)}</div>`;
    }
}

// Render job script (Tab 3)
function renderJobScriptData(data) {
    const content = document.getElementById('job-details-content');
    
    if (!data.available || !data.script) {
        content.innerHTML = `
            <div class="text-center text-muted" style="padding: 40px;">
                <i class="fas fa-file-code" style="font-size: 3rem; color: #ccc; margin-bottom: 15px; display: block;"></i>
                <p>Job script not available for this job.</p>
                <p style="font-size: 0.85rem; color: #999;">Scripts are only stored for batch jobs and may expire after some time.</p>
            </div>`;
        return;
    }
    
    content.innerHTML = `
        <div style="position: relative;">
            <button onclick="copyJobScript()" class="btn btn-sm" style="position: absolute; top: 10px; right: 20px; z-index: 10;">
                <i class="fas fa-copy"></i> Copy
            </button>
            <pre class="raw-output" id="job-script-content" style="padding-top: 45px;">${escapeHtml(data.script)}</pre>
        </div>`;
}

// Copy job script to clipboard
function copyJobScript() {
    const scriptContent = document.getElementById('job-script-content');
    if (scriptContent) {
        navigator.clipboard.writeText(scriptContent.textContent).then(() => {
            // Show brief feedback
            const btn = document.querySelector('[onclick="copyJobScript()"]');
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
            setTimeout(() => { btn.innerHTML = originalHtml; }, 2000);
        });
    }
}

// Make copy function globally accessible
window.copyJobScript = copyJobScript;

// Delete job function with confirmation
async function deleteJob(jobid) {
    event.stopPropagation();

    // Show confirmation dialog
    const confirmed = confirm(`Are you sure you want to cancel job ${jobid}?\n\nThis action cannot be undone.`);

    if (!confirmed) {
        return;
    }

    try {
        showLoading(true);

        const response = await fetch(`${window.APP_BASE_PATH}/api/job/${jobid}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            // Optimistic UI update: immediately remove job from the list
            currentJobs = currentJobs.filter(job => job.job_id !== jobid);

            // Re-render the filtered list for instant feedback
            filterCurrentJobs();

            // Show success toast
            showToast(`Job ${jobid} has been successfully cancelled.`, 'success', 'Job Cancelled');

            // Wait 3 seconds before refetching to give SLURM time to process the cancellation
            // This prevents the cancelled job from reappearing due to SLURM's processing delay
            setTimeout(async () => {
                await loadCurrentJobs();
            }, 3000);
        } else {
            throw new Error(result.error || 'Failed to cancel job');
        }
    } catch (error) {
        // Show error toast
        showToast(`Failed to cancel job ${jobid}: ${error.message}`, 'error', 'Cancellation Failed');

        // Refetch to restore correct state if cancellation failed
        await loadCurrentJobs();
    } finally {
        showLoading(false);
    }
}

// Make deleteJob function globally accessible
window.deleteJob = deleteJob;

// Toast notification system
function showToast(message, type = 'info', title = null, duration = 5000) {
    const container = document.getElementById('toast-container');

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    // Determine icon based on type
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        info: 'fa-info-circle',
        warning: 'fa-exclamation-triangle'
    };

    const icon = icons[type] || icons.info;

    // Determine default title based on type if not provided
    if (!title) {
        const titles = {
            success: 'Success',
            error: 'Error',
            info: 'Information',
            warning: 'Warning'
        };
        title = titles[type] || 'Notification';
    }

    // Build toast HTML
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fas ${icon}"></i>
        </div>
        <div class="toast-content">
            <div class="toast-title">${escapeHtml(title)}</div>
            <div class="toast-message">${escapeHtml(message)}</div>
        </div>
        <button class="toast-close" onclick="dismissToast(this)">
            <i class="fas fa-times"></i>
        </button>
    `;

    // Add to container
    container.appendChild(toast);

    // Auto-dismiss after duration (if duration > 0)
    if (duration > 0) {
        setTimeout(() => {
            dismissToast(toast.querySelector('.toast-close'));
        }, duration);
    }
}

// Dismiss a toast notification
function dismissToast(closeButton) {
    const toast = closeButton.closest('.toast');
    if (toast) {
        toast.classList.add('toast-exit');
        setTimeout(() => {
            toast.remove();
        }, 300); // Match animation duration
    }
}

// Make toast functions globally accessible
window.showToast = showToast;
window.dismissToast = dismissToast;

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

const USER_LIMIT_REASON_DETAILS = {
    QOSMaxBBPerUser: 'Burst buffer request exceeds per-user maximum for this QOS.',
    QOSMaxBillingPerUser: 'Billing request exceeds per-user maximum for this QOS.',
    QOSMaxCpuPerUserLimit: 'CPU request exceeds per-user maximum for this QOS.',
    QOSMaxEnergyPerUser: 'Energy request exceeds per-user maximum for this QOS.',
    QOSMaxGRESPerUser: 'GRES request exceeds per-user maximum for this QOS.',
    QOSMaxJobsPerUserLimit: 'User has reached max running jobs for this QOS.',
    QOSMaxLicensePerUser: 'License request exceeds per-user maximum for this QOS.',
    QOSMaxMemoryPerUser: 'Memory request exceeds per-user maximum for this QOS.',
    QOSMaxNodePerUserLimit: 'Node request exceeds per-user maximum for this QOS.',
    QOSMaxSubmitJobPerUserLimit: 'User has reached max running/pending jobs for this QOS.',
    QOSMaxUnknownPerUser: 'Unknown resource request exceeds per-user maximum for this QOS.'
};

function getUserLimitWarning(job) {
    if (!job || job.state !== 'PD') return null;
    const reason = (job.reason || '').trim();
    if (!reason) return null;

    const reasonCode = reason.split(',')[0].trim();
    // Slurm reason codes are often like QOSMaxCpuPerUserLimit, QOSMaxGRESPerUser, etc.
    // Match "Max...PerUser" patterns instead of only exact "MaxPerUser".
    const matchesUserLimit = /Max.*PerUser/i.test(reasonCode);
    if (!matchesUserLimit) {
        debugLog('Pending job reason does not match MaxPerUser', {
            job_id: job.job_id,
            reason,
            reason_code: reasonCode
        });
        return null;
    }

    const description = USER_LIMIT_REASON_DETAILS[reasonCode];
    const tooltip = description
        ? `Pending due to ${reasonCode}: ${description}`
        : `Pending due to ${reasonCode}. This indicates a per-user limit was exceeded.`;

    return { reasonCode, tooltip };
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
    if (s.includes('out_of_memory') || s === 'oom') return 'out_of_memory';
    return 'unknown';
}

// Make functions globally accessible
window.showJobDetails = showJobDetails;
window.closeJobDetailsModal = closeJobDetailsModal;

// Tooltip system for column headers
function initTooltips() {
    // Create tooltip element if it doesn't exist
    let tooltipEl = document.getElementById('column-tooltip');
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'column-tooltip';
        tooltipEl.className = 'column-tooltip';
        document.body.appendChild(tooltipEl);
    }

    // Get all tooltip headers
    const headers = document.querySelectorAll('.tooltip-header');
    
    headers.forEach(header => {
        header.addEventListener('mouseenter', (e) => {
            const tooltipText = header.getAttribute('data-tooltip');
            if (!tooltipText) return;
            
            tooltipEl.textContent = tooltipText;
            tooltipEl.classList.add('visible');
            
            // Position the tooltip below the header
            const rect = header.getBoundingClientRect();
            tooltipEl.style.left = rect.left + (rect.width / 2) + 'px';
            tooltipEl.style.top = rect.bottom + 8 + 'px';
        });
        
        header.addEventListener('mouseleave', () => {
            tooltipEl.classList.remove('visible');
        });
    });
}

function initUserLimitTooltips() {
    let tooltipEl = document.getElementById('column-tooltip');
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'column-tooltip';
        tooltipEl.className = 'column-tooltip';
        document.body.appendChild(tooltipEl);
    }

    document.addEventListener('mouseenter', (e) => {
        const warning = e.target.closest('.user-limit-warning');
        if (!warning) return;

        const tooltipText = warning.getAttribute('data-tooltip');
        if (!tooltipText) return;

        tooltipEl.textContent = tooltipText;
        tooltipEl.classList.add('visible');

        const rect = warning.getBoundingClientRect();
        tooltipEl.style.left = rect.left + (rect.width / 2) + 'px';
        tooltipEl.style.top = rect.bottom + 8 + 'px';
    }, true);

    document.addEventListener('mouseleave', (e) => {
        const warning = e.target.closest('.user-limit-warning');
        if (!warning) return;
        tooltipEl.classList.remove('visible');
    }, true);
}

// Tooltip for truncated job names
function initNameTooltips() {
    let tooltip = document.getElementById('name-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'name-tooltip';
        tooltip.className = 'name-tooltip';
        document.body.appendChild(tooltip);
    }

    document.addEventListener('mouseenter', (e) => {
        const cell = e.target.closest('.truncate-name');
        if (!cell) return;
        const fullName = cell.getAttribute('data-fullname');
        if (!fullName) return;

        tooltip.textContent = fullName;
        tooltip.style.display = 'block';

        const rect = cell.getBoundingClientRect();
        tooltip.style.left = rect.left + 'px';
        tooltip.style.top = rect.bottom + 'px';
    }, true);

    document.addEventListener('mouseleave', (e) => {
        const cell = e.target.closest('.truncate-name');
        if (!cell) return;
        tooltip.style.display = 'none';
    }, true);
}

// Initialize tooltips when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initTooltips();
    initUserLimitTooltips();
    initNameTooltips();
});
