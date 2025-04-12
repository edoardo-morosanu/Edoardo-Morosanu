import { config } from "dotenv";
import Mustache from "mustache";
import fs from "node:fs";
import { Octokit } from "@octokit/rest";

config(); // Loads environment variables

const octokit = new Octokit({
  auth: process.env.GH_ACCESS_TOKEN,
  userAgent: "readme-generator",
  baseUrl: "https://api.github.com",
});

async function grabDataFromAllRepositories() {
  const options = {
    per_page: 100,
  };
  const request = await octokit.rest.repos.listForAuthenticatedUser(options);
  return request.data;
}

function calculateTotalStars(data) {
  return data.reduce((sum, repo) => sum + repo.stargazers_count, 0);
}

async function calculateTotalCommits(data, cutoffDate) {
  const username = process.env.GH_USERNAME;
  let totalCommits = 0;
  let pendingRepos = [];

  for (const repo of data.filter(
    (repo) => !cutoffDate || new Date(repo.updated_at) > cutoffDate
  )) {
    try {
      const response = await octokit.rest.repos.getContributorsStats({
        owner: repo.owner.login,
        repo: repo.name,
      });

      if (response.status === 202) {
        pendingRepos.push(repo);
        continue;
      }

      if (Array.isArray(response.data)) {
        const userStats = response.data.find(
          (c) => c.author?.login === username
        );
        if (userStats) {
          const commits = cutoffDate
            ? userStats.weeks
                .filter((w) => new Date(w.w * 1000) > cutoffDate)
                .reduce((sum, w) => sum + w.c, 0)
            : userStats.total;

          totalCommits += commits;
        }
      }
    } catch (error) {
      // Silently continue on error
    }

    // Add a small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Try to fetch pending repos again
  if (pendingRepos.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds before retrying

    for (const repo of pendingRepos) {
      try {
        const response = await octokit.rest.repos.getContributorsStats({
          owner: repo.owner.login,
          repo: repo.name,
        });

        if (Array.isArray(response.data)) {
          const userStats = response.data.find(
            (c) => c.author?.login === username
          );
          if (userStats) {
            const commits = cutoffDate
              ? userStats.weeks
                  .filter((w) => new Date(w.w * 1000) > cutoffDate)
                  .reduce((sum, w) => sum + w.c, 0)
              : userStats.total;

            totalCommits += commits;
          }
        }
      } catch (error) {
        // Silently continue on error
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return totalCommits;
}

async function updateReadme(data) {
  const template = fs.readFileSync("./main.mustache", "utf-8");
  const output = Mustache.render(template, data);
  fs.writeFileSync("README.md", output);
}

async function main() {
  const repoData = await grabDataFromAllRepositories();
  const totalStars = calculateTotalStars(repoData);

  const lastYear = new Date();
  lastYear.setFullYear(lastYear.getFullYear() - 1);

  const totalCommitsInPastYear = await calculateTotalCommits(
    repoData,
    lastYear
  );
  const colors = ["474342", "fbedf6", "c9594d", "f8b9b2", "ae9c9d"];

  await updateReadme({ totalStars, totalCommitsInPastYear, colors });
}

main();
