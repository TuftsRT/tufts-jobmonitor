require 'open3'
require 'json'
require 'etc'
require 'set'
require 'shellwords'
require 'time'

module JobParser
  # Execute a command and return stdout
  def self.run_command(cmd)
    stdout, stderr, status =
      if cmd.is_a?(Array)
        Open3.capture3(*cmd)
      else
        Open3.capture3(cmd)
      end

    unless status.success?
      # Log to STDERR so it appears in server logs
      formatted_cmd = cmd.is_a?(Array) ? Shellwords.join(cmd) : cmd
      STDERR.puts "[JobParser] Command failed (exit #{status.exitstatus}): #{formatted_cmd}"
      STDERR.puts "[JobParser] STDERR: #{stderr}" unless stderr.empty?
      # Return stdout anyway - sacct may return partial results
      return stdout
    end
    stdout
  rescue => e
    STDERR.puts "[JobParser] Exception executing command: #{e.message}"
    STDERR.puts "[JobParser] Command was: #{cmd.is_a?(Array) ? Shellwords.join(cmd) : cmd}"
    ""
  end

  # Get current user's running and pending jobs using squeue
  def self.get_current_jobs(user_identifier: nil)
    user_identifier = normalize_user_identifier(user_identifier)
    cmd = ['squeue']
    cmd += user_identifier ? ['--user', user_identifier] : ['--me']
    cmd += ['-o', '%i|%j|%P|%t|%M|%l|%D|%C|%b|%N|%r|%q|%B', '--noheader']

    output = run_command(cmd)
    jobs = []
    
    output.each_line do |line|
      # Job names can contain the visible delimiter, so rebuild the name
      # from the middle fields and keep the fixed-position columns from the right.
      parts = parse_slurm_line(line, trailing_fields_count: 11)
      next unless parts
      
      # Parse GPU allocation from TRES format (e.g., gres/gpu:a100:1)
      gpu_tres = parts[8] || ''
      gpus = parse_gpu_tres(gpu_tres)
      gpu_model = parse_gpu_model(gpu_tres)
      
      state_code = parts[3]
      state_name = case state_code
      when 'R' then 'RUNNING'
      when 'PD' then 'PENDING'
      when 'CG' then 'COMPLETING'
      when 'CD' then 'COMPLETED'
      when 'F' then 'FAILED'
      when 'TO' then 'TIMEOUT'
      when 'CA' then 'CANCELLED'
      when 'NF' then 'NODE_FAIL'
      else state_code
      end
      
      job = {
        job_id: parts[0],
        name: parts[1],
        partition: parts[2],
        state: state_code,
        state_name: state_name,
        time_used: parts[4],
        time_limit: parts[5],
        nodes: parts[6].to_i,
        cpus: parts[7].to_i,
        gpus: gpus,
        gpu_model: gpu_model,
        node_list: parts[9] || 'N/A',
        reason: parts[10] || '',
        qos: parts[11] || 'N/A',
        batch_host: parts[12] || ''
      }
      
      jobs << job
    end
    
    jobs
  end

  # Get job history using sacct
  # Can be called with days (relative) or start_time/end_time (absolute)
  # Maximum range is 30 days
  def self.get_job_history(days: 7, start_time: nil, end_time: nil, user_identifier: nil)
    max_days = 30
    user_identifier = normalize_user_identifier(user_identifier) || current_user_identifier

    # Use custom date range if provided, otherwise calculate from days
    if start_time && end_time
      # Validate custom range doesn't exceed 30 days
      start_date = Time.parse(start_time)
      end_date = Time.parse(end_time)
      max_range = (max_days + 1) * 24 * 60 * 60 # + 1 day buffer
      raise ArgumentError, "Date range cannot exceed #{max_days} days" if end_date - start_date > max_range

      start_str = start_time
      end_str = end_time
    else
      # Cap days at max_days
      days = [days, max_days].min
      end_date = Time.now
      start_date = end_date - (days * 24 * 60 * 60)
      start_str = start_date.strftime('%Y-%m-%d')
      # Add 1 day to end_str to include today's jobs (sacct --endtime is exclusive)
      end_str = (end_date + 86400).strftime('%Y-%m-%d')
    end
    
    # Use sacct to get historical jobs (including ReqTRES for GPU info)
    cmd = [
      'sacct',
      '--user', user_identifier,
      '--starttime', start_str,
      '--endtime', end_str,
      '--format=JobID,JobName,Partition,State,Elapsed,Start,End,MaxRSS,ReqMem,NNodes,NCPUS,NodeList,ExitCode,ReqTRES,QOS',
      '--noheader',
      '--parsable2'
    ]

    output = run_command(cmd)
    
    jobs = []
    job_memory = {}  # Track max memory for each main job
    job_oom = {}     # Track if any step had OUT_OF_MEMORY state

    # First pass: collect memory from job steps and check for OOM
    output.each_line do |line|
      parts = parse_slurm_line(line, trailing_fields_count: 12)
      next unless parts

      job_id = parts[0]
      state = parts[3] || ''

      # Extract main job ID (before the dot)
      main_job_id = job_id.split('.').first

      # Track if any step had OUT_OF_MEMORY state
      if state.upcase.include?('OUT_OF_MEMORY')
        job_oom[main_job_id] = true
      end

      # Track the maximum memory usage across all steps
      max_rss_raw = parts[7] || ''
      if !max_rss_raw.strip.empty?
        # Convert to bytes for comparison
        current_bytes = parse_memory_to_bytes(max_rss_raw)
        if current_bytes > 0
          if !job_memory[main_job_id] || current_bytes > job_memory[main_job_id][:bytes]
            job_memory[main_job_id] = {
              bytes: current_bytes,
              raw: max_rss_raw,
              formatted: parse_memory(max_rss_raw)
            }
          end
        end
      end
    end
    
    # Second pass: build job list (only main jobs)
    seen_jobs = Set.new
    output.each_line do |line|
      parts = parse_slurm_line(line, trailing_fields_count: 13)
      next unless parts
      
      job_id = parts[0]
      
      # Skip job steps (e.g., 12345.batch, 12345.0), only keep main job
      next if job_id.include?('.')
      
      # Skip duplicates
      next if seen_jobs.include?(job_id)
      seen_jobs.add(job_id)
      
      # Get the maximum memory from all steps
      memory_info = job_memory[job_id]
      max_rss = memory_info ? memory_info[:formatted] : 'N/A'
      max_rss_raw = memory_info ? memory_info[:raw] : ''

      # If any step had OUT_OF_MEMORY, use that state (more informative than FAILED)
      state = parts[3]
      if job_oom[job_id]
        state = 'OUT_OF_MEMORY'
      end

      # Skip running/pending jobs — they belong in the current jobs section only
      next if ['RUNNING', 'PENDING'].include?(state)

      req_mem = parts[8]
      
      # Parse GPUs from ReqTRES field (index 13)
      req_tres = parts[13] || ''
      gpus = 0
      gpu_model = nil
      if req_tres =~ /gres\/gpu:(\w+):(\d+)/
        gpu_model = $1.upcase
        gpus = $2.to_i
      elsif req_tres =~ /gres\/gpu=(\d+)/
        gpus = $1.to_i
      end

      job = {
        job_id: job_id,
        name: parts[1],
        partition: parts[2],
        state: state,
        elapsed: parts[4],
        start: parts[5],
        end: parts[6],
        max_rss: max_rss,
        max_rss_raw: max_rss_raw,
        req_mem: req_mem,
        nodes: parts[9].to_i,
        cpus: parts[10].to_i,
        node_list: parts[11] || 'N/A',
        exit_code: parts[12],
        gpus: gpus,
        gpu_model: gpu_model,
        qos: parts[14] || 'N/A'
      }
      
      jobs << job
    end
    
    jobs
  end

  # Get detailed job information using scontrol (for current jobs) or sacct (for historical jobs)
  def self.get_job_details(jobid)
    # First try scontrol (works for running/pending jobs)
    output = run_command("scontrol show jobid -dd #{jobid}")
    
    # If scontrol returns empty or very short output, job is historical - use sacct
    if output.strip.empty? || output.length < 50
      return get_historical_job_details(jobid)
    end
    
    details = {
      job_id: jobid,
      raw_output: output
    }
    
    # Parse key fields from scontrol output
    details[:job_name] = output[/JobName=(\S+)/, 1]
    details[:user] = output[/UserId=(\w+)/, 1]
    details[:partition] = output[/Partition=(\S+)/, 1]
    details[:state] = output[/JobState=(\S+)/, 1]
    details[:start_time] = output[/StartTime=(\S+)/, 1]
    details[:end_time] = output[/EndTime=(\S+)/, 1]
    details[:time_limit] = output[/TimeLimit=(\S+)/, 1]
    details[:submit_time] = output[/SubmitTime=(\S+)/, 1]
    details[:work_dir] = output[/WorkDir=(\S+)/, 1]
    details[:std_out] = output[/StdOut=(\S+)/, 1]
    details[:std_err] = output[/StdErr=(\S+)/, 1]
    details[:nodes] = output[/NumNodes=(\S+)/, 1]
    details[:cpus] = output[/NumCPUs=(\S+)/, 1]
    details[:node_list] = output[/(?<!\w)NodeList=(\S+)/, 1]
    details[:batch_host] = output[/BatchHost=(\S+)/, 1]
    details[:reason] = output[/Reason=([^\n]+)/, 1]&.strip
    details[:req_mem] = output[/MinMemoryNode=(\S+)/, 1]

    # Parse QOS
    details[:qos] = output[/QOS=(\S+)/, 1]

    # Parse TRES (including GPUs)
    tres = output[/TRES=(\S+)/, 1]
    if tres
      details[:tres] = tres
      if tres =~ /gres\/gpu=(\d+)/
        details[:gpus] = $1.to_i
      end
    end

    # Parse GPU model from TresPerNode (e.g., gres/gpu:a100:1)
    tres_per_node = output[/TresPerNode=(\S+)/, 1]
    if tres_per_node && tres_per_node =~ /gres\/gpu:(\w+):(\d+)/
      details[:gpu_model] = $1.upcase
      details[:gpus] ||= $2.to_i
    end
    
    details
  end
  
  # Get historical job details using sacct
  def self.get_historical_job_details(jobid)
    # Use sacct with verbose format for historical jobs
    output = run_command(
      "sacct -j #{jobid} --format=JobID,JobName,User,Account,Partition,State," +
      "Submit,Start,End,Elapsed,TimeLimit,NCPUS,NNodes,NodeList,ReqMem,MaxRSS," +
      "ExitCode,WorkDir,ReqTRES,QOS --parsable2 --noheader"
    )
    
    # Also get the full format output for raw display
    raw_output = run_command("sacct -j #{jobid} -o ALL")
    
    details = {
      job_id: jobid,
      raw_output: raw_output,
      is_historical: true
    }
    
    # Parse first line (main job, not .batch or .extern)
    lines = output.strip.split("\n")
    main_job_line = lines.find { |line| !line.include?('.') && line.start_with?(jobid) }

    # Check if any job step has OUT_OF_MEMORY state
    has_oom = lines.any? do |line|
      fields = parse_slurm_line(line, trailing_fields_count: 18)
      fields && fields[5]&.upcase&.include?('OUT_OF_MEMORY')
    end

    if main_job_line
      fields = parse_slurm_line(main_job_line, trailing_fields_count: 18)
      return details unless fields

      details[:job_name] = fields[1]
      details[:user] = fields[2]
      details[:account] = fields[3]
      details[:partition] = fields[4]
      details[:state] = has_oom ? 'OUT_OF_MEMORY' : fields[5]
      details[:submit_time] = fields[6]
      details[:start_time] = fields[7]
      details[:end_time] = fields[8]
      details[:elapsed] = fields[9]
      details[:time_limit] = fields[10]
      details[:cpus] = fields[11]
      details[:nodes] = fields[12]
      details[:node_list] = fields[13]
      details[:req_mem] = fields[14]
      details[:max_rss] = fields[15]
      details[:exit_code] = fields[16]
      details[:work_dir] = fields[17] if fields[17] && !fields[17].empty?
      
      # Parse GPUs and GPU model from ReqTRES if available
      req_tres = fields[18]
      if req_tres
        if req_tres =~ /gres\/gpu:(\w+):(\d+)/
          details[:gpu_model] = $1.upcase
          details[:gpus] = $2.to_i
        elsif req_tres =~ /gres\/gpu=(\d+)/
          details[:gpus] = $1.to_i
        end
      end

      # If GPU was requested but model unknown, look it up from the node
      if details[:gpus] && details[:gpus] > 0 && !details[:gpu_model]
        node_name = details[:node_list]
        if node_name && node_name != 'N/A' && !node_name.empty?
          # Use first node if multiple (e.g., "node[001-002]" or "node001,node002")
          first_node = node_name.split(/[\[,]/)[0]
          details[:gpu_model] = get_node_gpu_model(first_node)
        end
      end

      # Parse QOS (index 19)
      details[:qos] = fields[19] if fields[19] && !fields[19].empty?
    end

    details
  end

  # Get job efficiency using seff
  def self.get_job_efficiency(jobid)
    output = run_command("seff #{jobid}")
    
    efficiency = {
      job_id: jobid,
      raw_output: output
    }
    
    # Parse seff output
    output.each_line do |line|
      case line
      when /Job ID:\s+(\S+)/
        efficiency[:job_id] = $1
      when /State:\s+(.+)/
        efficiency[:state] = $1.strip
      when /Cores:\s+(\d+)/
        efficiency[:cores] = $1.to_i
      when /CPU Utilized:\s+(.+)/
        efficiency[:cpu_utilized] = $1.strip
      when /CPU Efficiency:\s+([\d.]+)%/
        efficiency[:cpu_efficiency] = $1.to_f
      when /Job Wall-clock time:\s+(.+)/
        efficiency[:wallclock] = $1.strip
      when /Memory Utilized:\s+(.+)/
        efficiency[:memory_utilized] = $1.strip
      when /Memory Efficiency:\s+([\d.]+)%/
        efficiency[:memory_efficiency] = $1.to_f
      end
    end
    
    efficiency
  end

  # Get detailed job info using the jobinfo script
  def self.get_jobinfo(jobid)
    # Get the path to jobinfo script (in the app root directory)
    # __dir__ is lib/, so ../jobinfo goes to JobApp/jobinfo
    jobinfo_path = File.expand_path('../jobinfo', __dir__)
    
    if !File.exist?(jobinfo_path)
      return {
        job_id: jobid,
        error: "jobinfo script not found at #{jobinfo_path}",
        raw_output: "",
        fields: {}
      }
    end
    
    # Run jobinfo and capture both stdout and stderr
    stdout, stderr, status = Open3.capture3("#{jobinfo_path} #{jobid}")
    
    info = {
      job_id: jobid,
      raw_output: stdout,
      fields: {}
    }
    
    # If there was an error, include it
    if !status.success? || stdout.strip.empty?
      info[:error] = stderr.strip.empty? ? "jobinfo returned no output" : stderr.strip
      info[:raw_output] = "Error running jobinfo:\n#{stderr}\n\nStdout:\n#{stdout}"
    else
      # Parse jobinfo output
      stdout.each_line do |line|
        if line =~ /^\s*(.+?):\s+(.+)$/
          key = $1.strip
          value = $2.strip
          info[:fields][key] = value
        end
      end
    end
    
    info
  end

  # Get job summary statistics
  def self.get_job_summary(user_identifier: nil)
    current_jobs = get_current_jobs(user_identifier: user_identifier)
    
    running_jobs = current_jobs.select { |j| j[:state] == 'R' }
    pending_jobs = current_jobs.select { |j| j[:state] == 'PD' }
    other_jobs = current_jobs.reject { |j| ['R', 'PD'].include?(j[:state]) }
    
    {
      total_jobs: current_jobs.count,
      running_jobs: running_jobs.count,
      pending_jobs: pending_jobs.count,
      other_jobs: other_jobs.count,
      total_cpus_used: running_jobs.sum { |j| j[:cpus] },
      total_gpus_used: running_jobs.sum { |j| j[:gpus] },
      total_nodes_used: running_jobs.sum { |j| j[:nodes] }
    }
  end

  # Get the batch script used to submit the job
  def self.get_job_script(jobid)
    output = run_command(['sacct', '-j', jobid, '--batch-script'])
    script_lines = output.each_line.to_a.drop(2)
    script = script_lines.join

    {
      job_id: jobid,
      script: script.strip.empty? ? nil : script,
      available: !script.strip.empty?
    }
  end

  # Cancel a running or pending job using scancel, optionally recording an admin comment first.
  def self.cancel_job(jobid, comment: nil)
    if comment && !comment.to_s.strip.empty?
      update_stdout, update_stderr, update_status = Open3.capture3(
        'scontrol',
        'update',
        "JobId=#{jobid}",
        "Comment=#{comment}"
      )

      unless update_status.success?
        return {
          job_id: jobid,
          success: false,
          message: "Failed to record cancellation message for job #{jobid}",
          stdout: update_stdout,
          stderr: update_stderr
        }
      end
    end

    stdout, stderr, status = Open3.capture3('scancel', jobid)

    result_message =
      if status.success?
        comment && !comment.to_s.strip.empty? ? "Job #{jobid} cancelled and comment recorded successfully" : "Job #{jobid} cancelled successfully"
      else
        "Failed to cancel job #{jobid}"
      end

    {
      job_id: jobid,
      success: status.success?,
      message: result_message,
      stdout: stdout,
      stderr: stderr
    }
  rescue => e
    STDERR.puts "[JobParser] Exception cancelling job: #{e.message}"
    {
      job_id: jobid,
      success: false,
      message: "Exception: #{e.message}",
      stdout: "",
      stderr: e.message
    }
  end

  private

  def self.normalize_user_identifier(user_identifier)
    value = user_identifier.to_s.strip
    value.empty? ? nil : value
  end

  def self.current_user_identifier
    ENV['USER'].to_s.strip.tap do |value|
      return value unless value.empty?
    end

    Etc.getlogin.to_s.strip
  end

  def self.parse_slurm_line(line, trailing_fields_count:)
    parts = line.to_s.chomp.split('|', -1)
    return nil if parts.length < trailing_fields_count + 2

    leading_field = parts[0]
    middle_fields = parts[1...(parts.length - trailing_fields_count)]
    trailing_fields = parts.last(trailing_fields_count)

    [leading_field, middle_fields.join('|'), *trailing_fields]
  end

  # Parse GPU TRES format
  def self.parse_gpu_tres(gpu_tres)
    return 0 if gpu_tres.nil? || gpu_tres.empty? || gpu_tres == 'N/A'

    if gpu_tres =~ /gpu:(\w+):(\d+)/
      # Format: gres/gpu:TYPE:COUNT
      return $2.to_i
    elsif gpu_tres =~ /gpu:(\d+)/
      # Format: gres/gpu:COUNT
      return $1.to_i
    end

    0
  end

  # Look up GPU model from a node's Gres field (e.g., "gpu:a100:4(S:0-1)")
  def self.get_node_gpu_model(node_name)
    return nil if node_name.nil? || node_name.empty?

    output = run_command("scontrol show node #{node_name} 2>/dev/null")
    if output =~ /Gres=gpu:(\w+):/
      return $1.upcase
    end

    nil
  end

  # Parse GPU model from TRES format (e.g., gres/gpu:a100:1 -> "A100")
  def self.parse_gpu_model(gpu_tres)
    return nil if gpu_tres.nil? || gpu_tres.empty? || gpu_tres == 'N/A'

    if gpu_tres =~ /gpu:([a-zA-Z]\w*):(\d+)/
      return $1.upcase
    end

    nil
  end

  # Parse memory string to human-readable format
  def self.parse_memory(mem_str)
    return 'N/A' if mem_str.nil? || mem_str.empty?
    
    # Memory can be in format like "1234K", "5678M", "9G"
    if mem_str =~ /^([\d.]+)([KMGT]?)$/
      value = $1.to_f
      unit = $2
      
      case unit
      when 'K'
        return "#{(value / 1024).round(2)} MB"
      when 'M'
        return "#{value.round(2)} MB"
      when 'G'
        return "#{(value * 1024).round(2)} MB"
      when 'T'
        return "#{(value * 1024 * 1024).round(2)} MB"
      else
        return "#{value.round(2)} B"
      end
    end
    
    mem_str
  end
  
  # Parse memory string to bytes for comparison
  def self.parse_memory_to_bytes(mem_str)
    return 0 if mem_str.nil? || mem_str.empty?
    
    # Memory can be in format like "1234K", "5678M", "9G"
    if mem_str =~ /^([\d.]+)([KMGT]?)$/
      value = $1.to_f
      unit = $2
      
      case unit
      when 'K'
        return (value * 1024).to_i
      when 'M'
        return (value * 1024 * 1024).to_i
      when 'G'
        return (value * 1024 * 1024 * 1024).to_i
      when 'T'
        return (value * 1024 * 1024 * 1024 * 1024).to_i
      else
        return value.to_i  # Assume bytes if no unit
      end
    end
    
    0
  end
end
