require 'sinatra'
require 'etc'
require 'json'
require_relative 'lib/job_parser'

# Configure Sinatra
set :bind, '0.0.0.0'
set :public_folder, File.expand_path('public', __dir__)
set :views, File.expand_path('views', __dir__)
set :static, true
enable :static

helpers do
  ADMIN_GROUP_NAMES = ['tts_rsch_hpc_admin', 'TUFTS\\tts_rsch_hpc_admin'].freeze
  USER_IDENTIFIER_PATTERN = /\A[a-zA-Z0-9._-]+\z/
  # SLURM job IDs: numeric, optionally with array/het/step suffixes (e.g. 123, 123_4, 123+0, 123.batch)
  JOB_ID_PATTERN = /\A[0-9][0-9_.+]*\z/
  MAX_ADMIN_CANCEL_MESSAGE_LENGTH = 500

  # Validate a job id from the URL before it reaches any shell/command layer.
  def safe_job_id
    jobid = params[:jobid].to_s.strip
    halt 400, { success: false, error: 'Invalid job identifier' }.to_json unless jobid.match?(JOB_ID_PATTERN)
    jobid
  end

  def current_unix_user
    ENV['USER'].to_s.strip.tap do |value|
      return value unless value.empty?
    end

    Etc.getlogin.to_s.strip
  end

  def admin_scoping_enabled?
    @admin_scoping_enabled ||= ADMIN_GROUP_NAMES.any? do |group_name|
      begin
        group = Etc.getgrnam(group_name)
        group.gid == Process.gid || Process.groups.include?(group.gid) || group.mem.include?(current_unix_user)
      rescue ArgumentError
        false
      end
    end
  end

  def requested_user_identifier
    raw_value = params[:user].to_s.strip
    return nil if raw_value.empty?

    halt 403, { success: false, error: 'Admin user scoping is not available for this account' }.to_json unless admin_scoping_enabled?
    halt 400, { success: false, error: 'Invalid user identifier' }.to_json unless raw_value.match?(USER_IDENTIFIER_PATTERN)

    raw_value
  end

  def requested_cancel_message
    request.body.rewind
    raw_body = request.body.read.to_s
    return nil if raw_body.strip.empty?

    payload = JSON.parse(raw_body)
    message = payload['comment'].to_s.strip
    return nil if message.empty?

    halt 403, { success: false, error: 'Admin cancel messages are not available for this account' }.to_json unless admin_scoping_enabled?
    halt 400, { success: false, error: "Cancel message cannot exceed #{MAX_ADMIN_CANCEL_MESSAGE_LENGTH} characters" }.to_json if message.length > MAX_ADMIN_CANCEL_MESSAGE_LENGTH

    message
  rescue JSON::ParserError
    halt 400, { success: false, error: 'Invalid request payload' }.to_json
  end
end

# Main dashboard page
get '/' do
  # Asset versioning for cache busting
  @asset_v = Time.now.to_i
  erb :index, locals: { asset_v: @asset_v, admin_scoping_enabled: admin_scoping_enabled? }
end

# API endpoint for current jobs (running/pending)
get '/api/current-jobs' do
  content_type :json
  
  begin
    jobs = JobParser.get_current_jobs(user_identifier: requested_user_identifier)
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
    user_identifier = requested_user_identifier
    # Check for custom date range parameters
    start_time = params[:start]
    end_time = params[:end]

    if start_time && end_time
      # Validate that range doesn't exceed 30 days
      start_date = Time.parse(start_time)
      end_date = Time.parse(end_time)
      max_range = 31 * 24 * 60 * 60 # 30 days + 1 day buffer

      if end_date - start_date > max_range
        status 400
        return { success: false, error: 'Date range cannot exceed 30 days' }.to_json
      end

      jobs = JobParser.get_job_history(
        start_time: start_time,
        end_time: end_time,
        user_identifier: user_identifier
      )
    else
      # Get days parameter (default 7 days)
      days = params[:days]&.to_i || 7
      days = [days, 30].min # Max 30 days

      jobs = JobParser.get_job_history(days: days, user_identifier: user_identifier)
    end

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
    jobid = safe_job_id
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
    jobid = safe_job_id
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
    jobid = safe_job_id
    info = JobParser.get_jobinfo(jobid)
    { success: true, data: info }.to_json
  rescue => e
    status 500
    { success: false, error: e.message }.to_json
  end
end

# API endpoint for job script (batch script used to submit the job)
get '/api/job/:jobid/script' do
  content_type :json

  begin
    jobid = safe_job_id
    script = JobParser.get_job_script(jobid)
    { success: true, data: script }.to_json
  rescue => e
    status 500
    { success: false, error: e.message }.to_json
  end
end

# API endpoint to cancel a job
delete '/api/job/:jobid' do
  content_type :json

  begin
    jobid = safe_job_id
    result = JobParser.cancel_job(jobid, comment: requested_cancel_message)

    if result[:success]
      { success: true, message: result[:message] }.to_json
    else
      status 500
      { success: false, error: result[:message], stderr: result[:stderr] }.to_json
    end
  rescue => e
    status 500
    { success: false, error: e.message }.to_json
  end
end

# API endpoint for dashboard summary
get '/api/summary' do
  content_type :json
  
  begin
    summary = JobParser.get_job_summary(user_identifier: requested_user_identifier)
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
