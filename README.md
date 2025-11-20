# Job Monitor Dashboard

A comprehensive web-based dashboard for monitoring and managing SLURM jobs, featuring intelligent dual-mode operation that automatically uses the appropriate SLURM commands for both active (running/pending) and historical (completed/cancelled/failed) jobs.

## Features

### 📊 Real-time Job Monitoring
- View all your current running and pending jobs via `squeue`
- Auto-refresh every 30 seconds (toggleable)
- Filter jobs by state (Running, Pending, etc.)
- Search jobs by ID, name, partition, or node list
- Dynamic sorting by any column

### 📈 Job Statistics Dashboard
- Total active jobs count
- Running jobs with CPU/GPU usage metrics
- Pending jobs count
- Real-time resource utilization tracking

### 📜 Comprehensive Job History
- View historical jobs from the last 1, 3, 7, 14, or 30 days via `sacct`
- Filter by job state (Completed, Failed, Cancelled, Timeout)
- See detailed execution time, memory usage, and exit codes
- Track resource usage including CPU, GPU, and memory allocation
- Track job efficiency over time
- Search through historical jobs

### 🔍 Detailed Job Information (4 Tabs)
**Intelligent dual-mode operation:** The app automatically detects whether a job is active or historical and uses the appropriate SLURM commands:

**For Active Jobs (Running/Pending):**
- Uses `scontrol show jobid -dd` for detailed information
- Real-time status updates

**For Historical Jobs (Completed/Cancelled/Failed):**
- Uses `sacct` with comprehensive field selection
- Full job history with all metrics preserved

#### Tab Details:

1. **Job Info Tab**: Essential job metadata
   - Job ID, name, user, account, partition
   - Submit, start, and end times
   - Resource allocation (nodes, CPUs, GPUs)
   - Working directory and output file locations
   - **Historical jobs only:** Elapsed time, exit code, requested/used memory
   - Dynamically shows relevant fields based on job status
   - **Purpose:** Quick reference for "What job is this and when did it run?"

2. **Resource Utilization Tab**: Allocation efficiency (via `seff`)
   - **CPU Efficiency %**: (Total CPU time used) ÷ (Cores × Walltime) × 100
   - **Memory Efficiency %**: (Max memory used) ÷ (Requested memory) × 100
   - Wall-clock time vs CPU time comparison
   - Node-level performance data
   - Works for both active and completed jobs
   - **Purpose:** Answer "Did I request the right amount of resources?" and "Should I adjust my resource requests?"

3. **I/O & Performance Tab**: Performance breakdown (via `jobinfo` script)
   - 22+ parsed and formatted job metrics
   - **% User (Computation)**: Time spent on actual computation
   - **% System (I/O)**: Time spent on system calls and I/O operations
   - Maximum disk read/write statistics with node attribution
   - Maximum memory usage with detailed attribution
   - Wait time and scheduling analysis
   - **Purpose:** Answer "Is my job I/O bound or compute bound?" and "Where is the bottleneck?"

4. **Raw SLURM Data Tab**: Complete diagnostic output
   - **Active jobs:** Full `scontrol show jobid -dd` output
   - **Historical jobs:** Complete `sacct -o ALL` output with 80+ fields
   - Tab automatically adjusts title based on data source
   - **Purpose:** Deep debugging and advanced analysis

## Technology Stack

- **Backend**: Ruby with Sinatra framework
- **Frontend**: Vanilla JavaScript with modern CSS
- **Data Source**: SLURM commands (`squeue`, `sacct`, `scontrol`, `seff`)

## Installation

### Prerequisites

- Ruby (version 2.5 or higher)
- Access to a SLURM cluster
- Open OnDemand (optional, for integration)

### Setup

1. **Install required Ruby gems** (if not already available on your cluster):
```bash
gem install sinatra rack json
```

**Note:** The `Gemfile` is provided for reference, but many clusters (including HPC environments with Open OnDemand) already have these gems installed system-wide. The app will work without using `bundle install` if the gems are available. To check:
```bash
ruby -e "require 'sinatra'; require 'json'; puts 'All gems available!'"
```

2. Verify SLURM commands are available:
```bash
which squeue sacct scontrol seff
```

3. Ensure the `jobinfo` script is executable:
```bash
chmod +x jobinfo
```

## Running the Application

### Standalone

```bash
ruby app.rb
```

The application will start on port 4567 by default. Access it at `http://localhost:4567`

### With Rack

```bash
rackup config.ru
```

### In Open OnDemand

1. Copy the JobApp directory to your OOD apps directory:
```bash
cp -r JobApp /var/www/ood/apps/sys/
```

2. The app will be available in OOD under the "Jobs > Monitoring" category

## How It Works

### Intelligent Job Detection

The app automatically detects whether a job is active or historical and uses the appropriate SLURM commands:

1. **For Active Jobs (Running/Pending):**
   - Queries `squeue --me` for current job list
   - Uses `scontrol show jobid -dd` for detailed information
   - Provides real-time status updates

2. **For Historical Jobs (Completed/Cancelled/Failed):**
   - Queries `sacct` with date range filters
   - Automatically switches to `sacct` when `scontrol` returns empty
   - Retrieves comprehensive historical data including exit codes and resource usage

### SLURM Commands Used

#### Current Jobs List
```bash
squeue --me -o "%i|%j|%P|%t|%M|%l|%D|%C|%b|%N|%r" --noheader
```
Retrieves: Job ID, Name, Partition, State, Time Used, Time Limit, Nodes, CPUs, GPUs, Node List, Reason

#### Job History List
```bash
sacct --starttime YYYY-MM-DD --endtime YYYY-MM-DD \
  --format=JobID,JobName,Partition,State,Elapsed,Start,End,MaxRSS,ReqMem,NNodes,NCPUS,NodeList,ExitCode,ReqTRES \
  --noheader --parsable2
```
Retrieves: Complete job history with resource usage, exit codes, and GPU allocation (from ReqTRES)

#### Active Job Details
```bash
scontrol show jobid -dd <JOB_ID>
```
Retrieves: Real-time detailed information for running/pending jobs

#### Historical Job Details
```bash
sacct -j <JOB_ID> \
  --format=JobID,JobName,User,Account,Partition,State,Submit,Start,End,Elapsed,TimeLimit,NCPUS,NNodes,NodeList,ReqMem,MaxRSS,ExitCode,WorkDir,ReqTRES \
  --parsable2 --noheader

# Raw output for display
sacct -j <JOB_ID> -o ALL
```
Retrieves: Comprehensive historical job data with all available fields

#### Job Efficiency (Both Job Types)
```bash
seff <JOB_ID>
```
Retrieves: CPU and memory efficiency metrics

#### Comprehensive Job Info (Both Job Types)
```bash
./jobinfo <JOB_ID>
```
Retrieves: Parsed metrics including I/O statistics and detailed resource usage

## API Endpoints

The application provides several REST API endpoints:

- `GET /api/summary` - Job statistics summary
- `GET /api/current-jobs` - List of current (running/pending) jobs
- `GET /api/job-history?days=<N>` - Historical jobs (max 30 days)
- `GET /api/job/:jobid` - Detailed job information
- `GET /api/job/:jobid/efficiency` - Job efficiency metrics
- `GET /api/job/:jobid/info` - Comprehensive job info using jobinfo script
- `GET /health` - Health check endpoint

## Advanced Features

### Debug Mode
Access detailed logging by adding `?debug=1` to the URL:
```
http://localhost:4567?debug=1
```
- Shows all API calls and responses in browser console
- Displays parsed job data structures
- Helps verify SLURM command outputs
- Useful for troubleshooting and development

### Auto-Refresh
- Automatically updates all data every 30 seconds
- Toggle on/off with the switch in the header
- Shows last update timestamp
- Maintains current filters and search when refreshing

### Dynamic Sorting
- Click any table header to sort by that column
- Click again to reverse sort direction (ascending ↔ descending)
- Visual indicators show current sort column and direction
- Works independently on current and historical job tables

### Advanced Filtering

#### Current Jobs:
- Filter by state: All, Running, Pending
- Real-time search across job ID, name, partition, and node list
- Filters apply instantly without page reload

#### Historical Jobs:
- Filter by state: All, Completed, Failed, Cancelled, Timeout
- Select time range: 1, 3, 7, 14, or 30 days
- Combined search and filter capabilities
- Efficient handling of large job histories

### Responsive Design
- Mobile-first design approach
- Works seamlessly on desktop, tablet, and mobile devices
- Tables scroll horizontally on smaller screens
- Adaptive grid layout adjusts to screen size
- Touch-friendly controls and buttons
- Optimized modal dialogs for all screen sizes

## File Structure

```
JobApp/
├── app.rb              # Main Sinatra application
├── config.ru           # Rack configuration
├── manifest.yml        # OOD manifest file
├── jobinfo             # Job info Python script
├── README.md           # This file
├── lib/
│   └── job_parser.rb   # SLURM command parsing logic
├── public/
│   ├── styles.css      # Application styles
│   └── script.js       # Frontend JavaScript
└── views/
    └── index.erb       # Main HTML template
```

## Customization

### Changing Auto-Refresh Interval

Edit `public/script.js` and modify the interval (in milliseconds):

```javascript
autoRefreshInterval = setInterval(() => {
    loadAllData();
}, 30000); // Change 30000 to desired milliseconds
```

### Modifying Maximum History Days

Edit `app.rb` and change the maximum days limit:

```ruby
days = [days, 30].min # Change 30 to desired maximum
```

### Styling

Modify `public/styles.css` to change colors, fonts, layout, etc.

## Troubleshooting

### No jobs appearing
- Verify SLURM commands work: `squeue --me`
- Check if you have any jobs: `squeue -u $USER`
- Enable debug mode (`?debug=1`) and check browser console for errors
- Verify app has network connectivity to SLURM controller

### Historical job details showing "No output available"
- This is expected! Historical jobs use `sacct` instead of `scontrol`
- Check the Overview tab - it will show comprehensive data from `sacct`
- The app automatically detects and handles both job types

### Job details modal tabs
- **Job Info Tab:** Should always work for both active and historical jobs
- **Resource Utilization Tab:** Requires `seff` command (check: `which seff`) - shows allocation efficiency percentages
- **I/O & Performance Tab:** Requires `jobinfo` script to be executable - shows CPU/I/O breakdown
- **Raw SLURM Data Tab:** Shows `scontrol` for active jobs, `sacct` for historical jobs

### Understanding the different efficiency metrics
- **Resource Utilization tab** shows: "Did I waste resources?" (e.g., requested 16 cores but only used 2)
- **I/O & Performance tab** shows: "Where did the CPU time go?" (e.g., 85% computation, 15% I/O)
- These answer different questions and complement each other!

### Efficiency data missing
- Check if `seff` command is available: `which seff`
- Some clusters may not have `seff` installed
- The Overview tab still provides resource information

### jobinfo errors
- Ensure Python 3 is available: `which python3`
- Verify jobinfo script is executable: `chmod +x jobinfo`
- Test jobinfo directly: `./jobinfo <jobid>`
- The app works fine without jobinfo - other tabs provide comprehensive data

### Debug Mode Tips
Add `?debug=1` to URL to see:
- All API requests and responses
- Parsed job data structures
- SLURM command outputs
- Error messages and stack traces

## Technical Details

### Backend Architecture
- **Ruby/Sinatra**: Lightweight web framework for REST API
- **Intelligent Command Selection**: Automatically chooses between `scontrol` and `sacct` based on job status
- **Error Handling**: Graceful fallbacks when commands fail
- **Efficient Parsing**: Single-pass parsing of SLURM output

### Frontend Architecture
- **Vanilla JavaScript**: No framework dependencies, fast and lightweight
- **Dynamic Rendering**: Updates UI without full page reloads
- **State Management**: Maintains filters, sorts, and search across refreshes
- **Progressive Enhancement**: Core functionality works even if JavaScript features fail

### Data Flow
```
User Request → Sinatra Route → JobParser Module → SLURM Commands → Parse Output → JSON Response → JavaScript Rendering → DOM Update
```

### Performance Optimizations
- Parallel data fetching for summary, current jobs, and history
- Client-side filtering and sorting (no server roundtrips)
- Efficient DOM updates using innerHTML for bulk operations
- Caching of job data between refreshes
- Lazy loading of job details (only when modal is opened)

## Credits

- **Created by Javier Laveaga**
- Uses the `jobinfo` script by Anders Halager (https://github.com/birc-aeh/slurm-utils)
- Built for SLURM cluster job monitoring
- Designed to complement the Open OnDemand platform

## License

MIT License - Feel free to use and modify as needed.

---

**Created by Javier Laveaga**

