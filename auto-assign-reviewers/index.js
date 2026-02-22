const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Matches a file path against a glob-like pattern.
 * Supports: *, **, ?, and direct path matching.
 */
function matchPattern(filePath, pattern) {
  // Convert glob pattern to regex
  let regexStr = pattern
    // Escape regex special characters except * and ?
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // Handle ** (match any directory depth)
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    // Handle * (match within single directory)
    .replace(/\*/g, '[^/]*')
    // Handle ? (match single character)
    .replace(/\?/g, '[^/]')
    // Restore globstar
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');

  // If pattern doesn't start with a path separator, match anywhere in path
  if (!pattern.startsWith('/')) {
    regexStr = `(^|/)${regexStr}`;
  }

  // Match the entire remaining path
  regexStr = `${regexStr}$`;

  const regex = new RegExp(regexStr);
  return regex.test(filePath);
}

async function run() {
  try {
    const token = core.getInput('token', { required: true });
    const configPath = core.getInput('config-path');
    const maxReviewers = parseInt(core.getInput('max-reviewers'), 10);
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    // Get PR number
    const prNumber = github.context.payload.pull_request?.number;
    if (!prNumber) {
      core.setFailed('This action must be run on a pull_request event.');
      return;
    }

    const prAuthor = github.context.payload.pull_request.user.login;

    // Read the configuration file
    let config;
    const fullConfigPath = path.resolve(
      process.env.GITHUB_WORKSPACE || '.',
      configPath
    );

    try {
      const configContent = fs.readFileSync(fullConfigPath, 'utf8');
      config = yaml.load(configContent);
    } catch (err) {
      core.warning(
        `Could not read config file at ${configPath}: ${err.message}. Skipping reviewer assignment.`
      );
      core.setOutput('assigned-reviewers', '');
      return;
    }

    if (!config || !config.reviewers) {
      core.warning('No reviewers configuration found. Skipping assignment.');
      core.setOutput('assigned-reviewers', '');
      return;
    }

    // Fetch changed files in the PR
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });

    const changedFiles = files.map((f) => f.filename);
    core.info(`PR #${prNumber} has ${changedFiles.length} changed file(s)`);

    // Match changed files against reviewer patterns
    const reviewerScores = new Map();

    for (const rule of config.reviewers) {
      const patterns = Array.isArray(rule.patterns)
        ? rule.patterns
        : [rule.patterns];
      const reviewers = Array.isArray(rule.users) ? rule.users : [rule.users];

      let matched = false;
      for (const file of changedFiles) {
        for (const pattern of patterns) {
          if (matchPattern(file, pattern)) {
            matched = true;
            break;
          }
        }
        if (matched) break;
      }

      if (matched) {
        for (const reviewer of reviewers) {
          // Don't assign the PR author as reviewer
          if (reviewer.toLowerCase() === prAuthor.toLowerCase()) {
            continue;
          }
          const currentScore = reviewerScores.get(reviewer) || 0;
          reviewerScores.set(reviewer, currentScore + 1);
        }
      }
    }

    if (reviewerScores.size === 0) {
      core.info('No matching reviewers found for changed files.');

      // Use default reviewers if configured
      if (config.defaults && config.defaults.reviewers) {
        const defaults = config.defaults.reviewers.filter(
          (r) => r.toLowerCase() !== prAuthor.toLowerCase()
        );
        const selected = defaults.slice(0, maxReviewers);
        if (selected.length > 0) {
          core.info(
            `Using default reviewers: ${selected.join(', ')}`
          );
          await octokit.rest.pulls.requestReviewers({
            owner,
            repo,
            pull_number: prNumber,
            reviewers: selected,
          });
          core.setOutput('assigned-reviewers', selected.join(','));
          return;
        }
      }

      core.setOutput('assigned-reviewers', '');
      return;
    }

    // Sort reviewers by match score (descending) and select top N
    const sortedReviewers = [...reviewerScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reviewer]) => reviewer)
      .slice(0, maxReviewers);

    core.info(`Assigning reviewers: ${sortedReviewers.join(', ')}`);

    // Request reviews
    await octokit.rest.pulls.requestReviewers({
      owner,
      repo,
      pull_number: prNumber,
      reviewers: sortedReviewers,
    });

    core.setOutput('assigned-reviewers', sortedReviewers.join(','));

    // Write summary
    await core.summary
      .addHeading('Auto-Assigned Reviewers', 2)
      .addList(
        sortedReviewers.map(
          (r) => `@${r} (matched ${reviewerScores.get(r)} rule(s))`
        )
      )
      .write();
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

run();
