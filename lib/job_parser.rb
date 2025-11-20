require 'open3'
require 'json'
require 'time'

module JobParser
  # Execute a command and return stdout
  def self.run_command(cmd)
    stdout, stderr, status = Open3.capture3(cmd)
    return stdout if status.success?
    raise "Command failed: #{cmd}\n#{stderr}"
  rescue => e
    puts "Error executing command: #{e.message}"
    ""
  end

  # Get current user's running and pending jobs using squeue
  def self.get_current_jobs
    output = run_command('squeue --me -o "%i|%j|%P|%t|%M|%l|%D|%C|%b|%N|%r" --noheader')
    jobs = []
    
    output.each_line do |line|
      parts = line.strip.split('|')
      next if parts.length < 10
      
      # Parse GPU allocation from TRES format
      gpu_tres = parts[8] || ''
      gpus = parse_gpu_tres(gpu_tres)
      
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
        node_list: parts[9] || 'N/A',
        reason: parts[10] || ''
      }
      
      jobs << job
    end
    
    jobs
  end

  # Get job history using sacct
  def self.get_job_history(days = 7)
    # Calculate date range
    end_date = Time.now
    start_date = end_date - (days * 24 * 60 * 60)
    
    start_str = start_date.strftime('%Y-%m-%d')
    end_str = end_date.strftime('%Y-%m-%d')
    
    # Use sacct to get historical jobs (including ReqTRES for GPU info)
    output = run_command(
      "sacct --starttime #{start_str} --endtime #{end_str} " +
      "--format=JobID,JobName,Partition,State,Elapsed,Start,End,MaxRSS,ReqMem,NNodes,NCPUS,NodeList,ExitCode,ReqTRES " +
      "--noheader --parsable2"
    )
    
    jobs = []
    seen_jobs = Set.new
    
    output.each_line do |line|
      parts = line.strip.split('|')
      next if parts.length < 13
      
      job_id = parts[0]
      
      # Skip job steps (e.g., 12345.batch, 12345.0), only keep main job
      next if job_id.include?('.')
      
      # Skip duplicates
      next if seen_jobs.include?(job_id)
      seen_jobs.add(job_id)
      
      # Parse memory
      max_rss = parse_memory(parts[7])
      req_mem = parts[8]
      
      # Parse GPUs from ReqTRES field (index 13)
      req_tres = parts[13] || ''
      gpus = 0
      if req_tres =~ /gres\/gpu=(\d+)/
        gpus = $1.to_i
      elsif req_tres =~ /gres\/gpu:[\w]+:(\d+)/
        gpus = $1.to_i
      end
      
      job = {
        job_id: job_id,
        name: parts[1],
        partition: parts[2],
        state: parts[3],
        elapsed: parts[4],
        start: parts[5],
        end: parts[6],
        max_rss: max_rss,
        max_rss_raw: parts[7],
        req_mem: req_mem,
        nodes: parts[9].to_i,
        cpus: parts[10].to_i,
        node_list: parts[11] || 'N/A',
        exit_code: parts[12],
        gpus: gpus
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
    details[:start_time] = output[/StartTime=([^\s]+(?:\s+[^\s]+)?)/, 1]
    details[:end_time] = output[/EndTime=([^\s]+(?:\s+[^\s]+)?)/, 1]
    details[:time_limit] = output[/TimeLimit=(\S+)/, 1]
    details[:submit_time] = output[/SubmitTime=([^\s]+(?:\s+[^\s]+)?)/, 1]
    details[:work_dir] = output[/WorkDir=(\S+)/, 1]
    details[:std_out] = output[/StdOut=(\S+)/, 1]
    details[:std_err] = output[/StdErr=(\S+)/, 1]
    details[:nodes] = output[/NumNodes=(\S+)/, 1]
    details[:cpus] = output[/NumCPUs=(\S+)/, 1]
    details[:node_list] = output[/NodeList=(\S+)/, 1]
    details[:reason] = output[/Reason=([^\n]+)/, 1]&.strip
    
    # Parse TRES (including GPUs)
    tres = output[/TRES=(\S+)/, 1]
    if tres
      details[:tres] = tres
      if tres =~ /gres\/gpu=(\d+)/
        details[:gpus] = $1.to_i
      end
    end
    
    details
  end
  
  # Get historical job details using sacct
  def self.get_historical_job_details(jobid)
    # Use sacct with verbose format for historical jobs
    output = run_command(
      "sacct -j #{jobid} --format=JobID,JobName,User,Account,Partition,State," +
      "Submit,Start,End,Elapsed,TimeLimit,NCPUS,NNodes,NodeList,ReqMem,MaxRSS," +
      "ExitCode,WorkDir,ReqTRES --parsable2 --noheader"
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
    
    if main_job_line
      fields = main_job_line.split('|')
      details[:job_name] = fields[1]
      details[:user] = fields[2]
      details[:account] = fields[3]
      details[:partition] = fields[4]
      details[:state] = fields[5]
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
      
      # Parse GPUs from ReqTRES if available
      req_tres = fields[18]
      if req_tres && req_tres =~ /gres\/gpu=(\d+)/
        details[:gpus] = $1.to_i
      end
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
  def self.get_job_summary
    current_jobs = get_current_jobs
    
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

  private

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
end

