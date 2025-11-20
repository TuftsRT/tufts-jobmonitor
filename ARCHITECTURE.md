# JobApp Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User's Browser                            │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Frontend (HTML/CSS/JavaScript)                         │    │
│  │  - Stats Dashboard                                      │    │
│  │  - Current Jobs Table                                   │    │
│  │  - Job History Table                                    │    │
│  │  - Job Details Modal                                    │    │
│  └────────────────────────────────────────────────────────┘    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP/REST API
                            │
┌───────────────────────────┴─────────────────────────────────────┐
│                      Sinatra Web Server                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  app.rb (Routes & API Endpoints)                        │    │
│  │  - GET /                                                │    │
│  │  - GET /api/summary                                     │    │
│  │  - GET /api/current-jobs                                │    │
│  │  - GET /api/job-history                                 │    │
│  │  - GET /api/job/:id                                     │    │
│  │  - GET /api/job/:id/efficiency                          │    │
│  │  - GET /api/job/:id/info                                │    │
│  └────────────────────────────────────────────────────────┘    │
│                            │                                     │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  lib/job_parser.rb (Business Logic)                     │    │
│  │  - parse SLURM commands                                 │    │
│  │  - format job data                                      │    │
│  │  - aggregate statistics                                 │    │
│  └────────────────────────────────────────────────────────┘    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Shell Commands
                            │
┌───────────────────────────┴─────────────────────────────────────┐
│                      SLURM Cluster                               │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  SLURM Commands                                         │    │
│  │  - squeue    (current jobs)                             │    │
│  │  - sacct     (job history)                              │    │
│  │  - scontrol  (detailed job info)                        │    │
│  │  - seff      (job efficiency)                           │    │
│  │  - jobinfo   (comprehensive metrics)                    │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Current Jobs View
```
Browser → GET /api/current-jobs → JobParser.get_current_jobs()
   ↓                                      ↓
   │                                `squeue --me`
   │                                      ↓
   │                                Parse output
   │                                      ↓
   ←────────── JSON Response ─────── Format data
```

### 2. Job History View
```
Browser → GET /api/job-history?days=7 → JobParser.get_job_history(7)
   ↓                                           ↓
   │                                   `sacct --starttime ... --endtime ...`
   │                                           ↓
   │                                     Parse output
   │                                           ↓
   │                                   Filter duplicates
   │                                           ↓
   ←────────── JSON Response ──────────── Format data
```

### 3. Job Details View
```
Browser → GET /api/job/12345 → JobParser.get_job_details(12345)
   ↓                                    ↓
   │                           `scontrol show jobid -dd 12345`
   │                                    ↓
   │                              Parse output
   │                                    ↓
   ←────────── JSON Response ────── Format data
```

## File Structure

```
JobApp/
│
├── app.rb                  # Main application (routes & API)
│   ├── Route handlers
│   ├── Error handling
│   └── JSON responses
│
├── config.ru               # Rack configuration
│
├── manifest.yml            # OOD metadata
│
├── Gemfile                 # Ruby dependencies
│
├── jobinfo                 # Python script for detailed metrics
│
├── lib/
│   └── job_parser.rb      # Core business logic
│       ├── get_current_jobs()      → squeue
│       ├── get_job_history()       → sacct
│       ├── get_job_details()       → scontrol
│       ├── get_job_efficiency()    → seff
│       ├── get_jobinfo()           → jobinfo script
│       └── get_job_summary()       → aggregates data
│
├── public/                 # Static assets
│   ├── styles.css         # Application styling
│   │   ├── Layout & grid
│   │   ├── Tables
│   │   ├── Modal dialogs
│   │   └── Responsive design
│   │
│   └── script.js          # Frontend logic
│       ├── Data fetching
│       ├── Table rendering
│       ├── Filtering & sorting
│       ├── Modal management
│       └── Auto-refresh
│
└── views/
    └── index.erb          # HTML template
        ├── Header & controls
        ├── Stats dashboard
        ├── Current jobs table
        ├── Job history table
        └── Job details modal
```

## Component Responsibilities

### Frontend (script.js)
- **Data Management**: Fetch and cache job data
- **Rendering**: Display jobs in tables with proper formatting
- **Filtering**: Search and filter jobs by various criteria
- **Sorting**: Sort tables by different columns
- **Modal**: Display detailed job information in tabs
- **Auto-refresh**: Periodically update data

### Backend (app.rb)
- **Routing**: Handle HTTP requests
- **API**: Provide RESTful endpoints
- **Error Handling**: Catch and report errors
- **Response Formatting**: Return JSON responses

### Parser (job_parser.rb)
- **Command Execution**: Run SLURM commands safely
- **Output Parsing**: Extract data from command output
- **Data Transformation**: Format data for frontend
- **Aggregation**: Calculate summary statistics

## API Endpoints

| Endpoint | Method | Description | SLURM Command |
|----------|--------|-------------|---------------|
| `/` | GET | Main dashboard page | - |
| `/api/summary` | GET | Job statistics | squeue |
| `/api/current-jobs` | GET | Running/pending jobs | squeue --me |
| `/api/job-history?days=N` | GET | Historical jobs | sacct |
| `/api/job/:id` | GET | Job details | scontrol show jobid |
| `/api/job/:id/efficiency` | GET | Job efficiency | seff |
| `/api/job/:id/info` | GET | Detailed metrics | jobinfo |
| `/health` | GET | Health check | - |

## Key Features

### Real-time Updates
- Auto-refresh every 30 seconds
- Manual refresh button
- Last update timestamp

### Job Filtering
- **Current Jobs**: All, Running, Pending
- **Historical Jobs**: All, Completed, Failed, Cancelled, Timeout
- **Time Range**: 1-30 days for history
- **Search**: By ID, name, partition, nodes

### Job Details Modal
Four tabbed views:
1. **Overview**: Key job information
2. **Efficiency**: Resource utilization metrics
3. **Detailed**: Comprehensive jobinfo output
4. **Raw**: Complete scontrol output

### Responsive Design
- Desktop-optimized layout
- Mobile-friendly tables
- Adaptive components

## Security Considerations

- **User Isolation**: Only shows jobs for current user (`squeue --me`)
- **Command Safety**: Uses Ruby's Open3 for safe command execution
- **HTML Escaping**: All user data is escaped before display
- **No Direct Input**: No user input passed directly to shell commands

## Performance Optimizations

- **Parallel Fetching**: Loads multiple datasets simultaneously
- **Caching**: Frontend caches data between refreshes
- **Efficient Parsing**: Single-pass parsing of SLURM output
- **Lazy Loading**: Job details loaded on demand

## Extension Points

### Adding New Filters
1. Add filter control in `views/index.erb`
2. Update filter function in `public/script.js`
3. No backend changes needed

### Adding New Job Fields
1. Modify format string in `job_parser.rb`
2. Update parsing logic
3. Add column to table in `views/index.erb`
4. Update rendering in `public/script.js`

### Adding New API Endpoints
1. Add route in `app.rb`
2. Implement parser function in `job_parser.rb`
3. Update frontend to call new endpoint

### Custom Styling
- Modify colors in `public/styles.css`
- Update gradient colors in header
- Customize state badge colors
- Adjust responsive breakpoints

