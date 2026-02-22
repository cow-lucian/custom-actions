const core = require('@actions/core');
const github = require('@actions/github');

// Conventional Commits pattern
// Format: <type>[optional scope][optional !]: <description>
const CONVENTIONAL_COMMIT_REGEX =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-zA-Z0-9._-]+\))?(!)?\s*:\s*.+/;

// Additional patterns to allow
const MERGE_COMMIT_REGEX = /^Merge\s/;
const REVERT_COMMIT_REGEX = /^Revert\s"/;

const VALID_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];

function validateCommitMessage(message) {
  const firstLine = message.split('\n')[0].trim();

  // Allow merge commits
  if (MERGE_COMMIT_REGEX.test(firstLine)) {
    return { valid: true };
  }

  // Allow revert commits
  if (REVERT_COMMIT_REGEX.test(firstLine)) {
    return { valid: true };
  }

  // Check conventional commit format
  if (!CONVENTIONAL_COMMIT_REGEX.test(firstLine)) {
    // Try to give a helpful error message
    const colonIndex = firstLine.indexOf(':');
    if (colonIndex === -1) {
      return {
        valid: false,
        error: `Missing type prefix. Expected format: "type: description" or "type(scope): description". Valid types: ${VALID_TYPES.join(', ')}`,
      };
    }

    const prefix = firstLine.substring(0, colonIndex).trim();
    const typeMatch = prefix.match(/^([a-zA-Z]+)/);
    if (typeMatch && !VALID_TYPES.includes(typeMatch[1])) {
      return {
        valid: false,
        error: `Invalid type "${typeMatch[1]}". Valid types: ${VALID_TYPES.join(', ')}`,
      };
    }

    const description = firstLine.substring(colonIndex + 1).trim();
    if (!description) {
      return {
        valid: false,
        error: 'Missing description after type prefix.',
      };
    }

    return {
      valid: false,
      error: `Invalid commit message format. Expected: "type: description" or "type(scope): description". Valid types: ${VALID_TYPES.join(', ')}`,
    };
  }

  // Validate description is not empty and starts reasonably
  const colonIndex = firstLine.indexOf(':');
  const description = firstLine.substring(colonIndex + 1).trim();
  if (description.length === 0) {
    return {
      valid: false,
      error: 'Description cannot be empty.',
    };
  }

  if (description.length > 100) {
    return {
      valid: false,
      error: `Description is too long (${description.length} chars). Keep the first line under 100 characters.`,
    };
  }

  return { valid: true };
}

async function run() {
  try {
    const token = core.getInput('token', { required: true });
    const strict = core.getInput('strict') === 'true';
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    // Get PR number
    const prNumber = github.context.payload.pull_request?.number;
    if (!prNumber) {
      core.setFailed('This action must be run on a pull_request event.');
      return;
    }

    // Fetch commits in the PR
    const commits = await octokit.paginate(
      octokit.rest.pulls.listCommits,
      {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      }
    );

    core.info(`Found ${commits.length} commit(s) in PR #${prNumber}`);

    const errors = [];
    let allValid = true;

    for (const commit of commits) {
      const sha = commit.sha;
      const message = commit.commit.message;
      const shortSha = sha.substring(0, 7);

      const result = validateCommitMessage(message);

      if (!result.valid) {
        allValid = false;
        const firstLine = message.split('\n')[0];
        const errorObj = {
          sha,
          message: firstLine,
          error: result.error,
        };
        errors.push(errorObj);

        // Create annotation
        const level = strict ? 'error' : 'warning';
        core.info(`::${level}::Commit ${shortSha}: ${result.error}%0A  Message: "${firstLine}"`);

        // Also log it clearly
        core[strict ? 'error' : 'warning'](
          `${shortSha} - "${firstLine}"\n  ${result.error}`
        );
      } else {
        core.info(`  ${shortSha} - valid`);
      }
    }

    // Set outputs
    core.setOutput('valid', allValid.toString());
    core.setOutput('errors', JSON.stringify(errors));

    // Summary
    if (errors.length > 0) {
      const summary = core.summary
        .addHeading('Commit Message Lint Results', 2)
        .addRaw(`Found **${errors.length}** invalid commit message(s) out of ${commits.length} total.\n\n`);

      const tableRows = [
        [
          { data: 'SHA', header: true },
          { data: 'Message', header: true },
          { data: 'Error', header: true },
        ],
      ];

      for (const err of errors) {
        tableRows.push([
          { data: `\`${err.sha.substring(0, 7)}\`` },
          { data: err.message },
          { data: err.error },
        ]);
      }

      summary.addTable(tableRows);
      summary.addRaw(
        '\n\nExpected format: `type(scope): description`\n\n' +
        `Valid types: \`${VALID_TYPES.join('`, `')}\``
      );

      await summary.write();

      if (strict) {
        core.setFailed(
          `${errors.length} commit message(s) do not follow Conventional Commits.`
        );
      }
    } else {
      await core.summary
        .addHeading('Commit Message Lint Results', 2)
        .addRaw(
          `All **${commits.length}** commit message(s) follow the Conventional Commits specification.`
        )
        .write();

      core.info('All commit messages are valid!');
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

run();
