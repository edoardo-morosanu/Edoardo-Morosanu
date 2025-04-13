import { config } from "dotenv";
import Mustache from "mustache";
import fs from "node:fs/promises"; // Use async file system API
import { Octokit } from "@octokit/rest";

config();

const octokit = new Octokit({
  auth: process.env.GH_ACCESS_TOKEN,
  userAgent: "readme-generator",
  baseUrl: "https://api.github.com",
});

// Utility: Sleep for a given number of milliseconds
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function grabDataFromAllRepositories() {
  const options = { per_page: 100 };
  const request = await octokit.rest.repos.listForAuthenticatedUser(options);
  return request.data;
}

function calculateTotalStars(data) {
  return data.reduce((sum, repo) => sum + repo.stargazers_count, 0);
}

// Utility: Calculate commits from stats given an optional cutoffDate.
function calculateCommitsFromStats(userStats, cutoffDate) {
  if (!userStats) return 0;
  if (cutoffDate) {
    return userStats.weeks
      .filter((w) => new Date(w.w * 1000) > cutoffDate)
      .reduce((sum, w) => sum + w.c, 0);
  }
  return userStats.total;
}

// Fetch contributor stats for a single repo with retries if pending (status 202).
async function fetchContributorStats(
  repo,
  username,
  cutoffDate,
  maxRetries = 5
) {
  let attempts = 0;
  while (attempts <= maxRetries) {
    try {
      const response = await octokit.rest.repos.getContributorsStats({
        owner: repo.owner.login,
        repo: repo.name,
      });

      if (response.status === 202) {
        // Wait with progressive delay and try again
        await sleep((attempts + 1) * 2000);
        attempts++;
        continue;
      }
      if (Array.isArray(response.data)) {
        const userStats = response.data.find(
          (c) => c.author?.login === username
        );
        return calculateCommitsFromStats(userStats, cutoffDate);
      }
    } catch (error) {
      console.error(`Error fetching stats for ${repo.name}:`, error);
      break;
    }
  }
  // Return 0 commits if fetching fails or remains pending after retries
  return 0;
}

async function calculateTotalCommits(data, cutoffDate) {
  const username = process.env.GH_USERNAME;
  const reposToProcess = data.filter(
    (repo) => !cutoffDate || new Date(repo.updated_at) > cutoffDate
  );

  // Map each repo to a task that fetches its commit count
  const tasks = reposToProcess.map((repo) => async () => {
    const commits = await fetchContributorStats(repo, username, cutoffDate);
    await sleep(100); // small delay to ease potential rate limiting
    return commits;
  });

  // Run all tasks concurrently
  const results = await Promise.all(tasks.map((task) => task()));
  return results.reduce((total, commits) => total + commits, 0);
}

async function updateReadme(data) {
  const template = await fs.readFile("./main.mustache", "utf-8");
  const output = Mustache.render(template, data);
  await fs.writeFile("README.md", output);
}

async function main() {
  try {
    const repoData = await grabDataFromAllRepositories();
    const totalStars = calculateTotalStars(repoData);

    const lastYear = new Date();
    lastYear.setFullYear(lastYear.getFullYear() - 1);

    const totalCommitsInPastYear = await calculateTotalCommits(
      repoData,
      lastYear
    );
    // Update README with only the data needed in the mustache template
    await updateReadme({ totalStars, totalCommitsInPastYear });
    console.log("README updated successfully.");
  } catch (error) {
    console.error("Error in main execution:", error);
  }
}

main();
