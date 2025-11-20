require 'sinatra'
require 'json'
require_relative 'lib/job_parser'

# Configure Sinatra
set :bind, '0.0.0.0'
set :public_folder, File.expand_path('public', __dir__)
set :views, File.expand_path('views', __dir__)
set :static, true
enable :static

# Main dashboard page
get '/' do
  # Asset versioning for cache busting
  @asset_v = Time.now.to_i
  erb :index, locals: { asset_v: @asset_v }
end

# API endpoint for current jobs (running/pending)
get '/api/current-jobs' do
  content_type :json
  
  begin
    jobs = JobParser.get_current_jobs
    { success: true, data: jobs }.to_json
  rescue => e
    status 500
    { success: false, error: e.message }.to_json
  end
end

# API endpoint for job history
get '/api/job-history' do
  content_type :json
  
  begin
    # Get days parameter (default 7 days)
    days = params[:days]&.to_i || 7
    days = [days, 30].min # Max 30 days
    
    jobs = JobParser.get_job_history(days)
    { success: true, data: jobs }.to_json
  rescue => e
    status 500
    { success: false, error: e.message }.to_json
  end
end

# API endpoint for detailed job info
get '/api/job/:jobid' do
  content_type :json
  
  begin
    jobid = params[:jobid]
    details = JobParser.get_job_details(jobid)
    { success: true, data: details }.to_json
  rescue => e
    status 500
    { success: false, error: e.message }.to_json
  end
end

# API endpoint for job efficiency (seff)
get '/api/job/:jobid/efficiency' do
  content_type :json
  
  begin
    jobid = params[:jobid]
    efficiency = JobParser.get_job_efficiency(jobid)
    { success: true, data: efficiency }.to_json
  rescue => e
    status 500
    { success: false, error: e.message }.to_json
  end
end

# API endpoint for job info (using jobinfo script)
get '/api/job/:jobid/info' do
  content_type :json
  
  begin
    jobid = params[:jobid]
    info = JobParser.get_jobinfo(jobid)
    { success: true, data: info }.to_json
  rescue => e
    status 500
    { success: false, error: e.message }.to_json
  end
end

# API endpoint for dashboard summary
get '/api/summary' do
  content_type :json
  
  begin
    summary = JobParser.get_job_summary
    { success: true, data: summary }.to_json
  rescue => e
    status 500
    { success: false, error: e.message }.to_json
  end
end

# Health check endpoint
get '/health' do
  content_type :json
  { status: 'ok', timestamp: Time.now.to_i }.to_json
end

