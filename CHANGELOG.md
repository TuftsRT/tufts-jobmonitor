# Changelog

All notable changes to Tufts Job Monitor are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-07-14

### Security

- **Eliminated shell command injection.** Every Slurm invocation
  (`squeue`, `sacct`, `scontrol`, `seff`, `scancel`, `jobinfo`) now passes
  arguments as an array to `Open3.capture3` instead of building an interpolated
  shell string, so job IDs and user names can no longer break out into the shell.
- **Job ID validation.** All `/api/job/:jobid` routes run the id through
  `safe_job_id`, rejecting anything that isn't a valid Slurm job id
  (`123`, `123_4`, `123+0`, `123.batch`) with a 400 before it reaches a command.
- **User identifier validation.** The admin `?user=` parameter is checked
  against a strict character allowlist and rejected with 400 if malformed.
- **Removed the `/api/debug/sacct` endpoint,** which exposed raw command
  construction and output.
- **Output escaping.** New node/SSH links and detail fields are rendered through
  `escapeHtml`, and the shell hostname is `encodeURIComponent`-encoded in the URL.

### Added

- **Admin user scoping.** Members of the `tts_rsch_hpc_admin` group can view any
  user's jobs via an "Admin view" box in the header (backed by `?user=<UTLN>`).
  Non-admins receive 403 if they attempt to scope. Detection is via Unix group
  membership (`Etc.getgrnam`).
- **Admin cancel with recorded message.** When an admin cancels another user's
  job, a modal collects a message that is written to the job
  (`scontrol update JobId=… Comment=…`, max 500 chars) before `scancel` runs.
  A default explanatory message is pre-filled.
- **Custom date range for job history** (`datetime-local` start/end) in addition
  to the relative presets, capped at 30 days and validated on both client and
  server.
- **Out-of-memory detection.** Jobs whose steps report `OUT_OF_MEMORY` are
  surfaced as `OUT_OF_MEMORY` (instead of a bare `FAILED`), with a matching
  "Out of Memory" filter option.
- **GPU model display.** GPU architecture (e.g. A100) is parsed from
  TRES/ReqTRES/TresPerNode, with a fallback lookup of the node's `Gres` field
  when the model isn't in the accounting record. Shown in tables and job details.
- **QOS column/field** added to current jobs, job history, and job details.
- **SSH shortcut links.** Node names for running jobs link to the OOD Shell app
  (single-node jobs link to the node; multi-node jobs link to the batch host).
- **Embeddable dashboard view** (`views/dashboard_iframe.html.erb`) so the app
  can replace the built-in OOD "Active Jobs" page via an iframe, plus README
  instructions for the override.
- `LICENSE` (MIT) and this `CHANGELOG.md`.

### Changed

- **Job-name parsing hardened.** A new `parse_slurm_line` helper rebuilds job
  names that contain the `|` field delimiter by anchoring on the fixed trailing
  columns, preventing field misalignment.
- **Job history excludes running/pending jobs**, which now appear only in the
  Current Jobs section.
- **Job-script retrieval** no longer shells out through `tail`; the header lines
  are dropped in Ruby.
- **`scontrol` detail parsing** improvements: `NodeList` regex no longer matches
  inside other keys (e.g. `BatchHost`), and `BatchHost`, `MinMemoryNode`, and
  `QOS` are now captured.
- **Auto-refresh interval** increased from 30s to 120s.
- **History filters simplified** to 24 hours / 7 days / 30 days / Custom Range
  (removed the 3- and 14-day presets).
- **Responsive tables**: lower-priority columns are progressively hidden on
  small/medium screens (`d-no-small` / `d-no-medium`).
- **Manifest** set `category: ""` and `new_window: false` for embedded use; page
  title changed to "Active Jobs Dashboard".

### Fixed

- Job names containing `|` no longer corrupt the parsed columns.
- Historical GPU jobs missing a model in accounting data now resolve the model
  from the assigned node.

## [1.0.0] - 2026-01-20

- Initial release: SLURM job monitoring for OnDemand with current jobs, job
  history, job details modal, efficiency (`seff`), `jobinfo`, batch-script view,
  and job cancellation.

[1.1.0]: https://github.com/TuftsRT/tufts-jobmonitor/releases/tag/v1.1.0
[1.0.0]: https://github.com/TuftsRT/tufts-jobmonitor/releases/tag/v1.0.0
