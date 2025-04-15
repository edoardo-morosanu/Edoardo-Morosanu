import { config } from "dotenv";
import Mustache from "mustache";
import fs from "node:fs/promises";
import { Octokit } from "@octokit/rest";

config();

const octokit = new Octokit({
  auth: process.env.GH_ACCESS_TOKEN,
  userAgent: "readme-generator",
  baseUrl: "https://api.github.com",
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function grabDataFromAllRepositories() {
  return await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
    per_page: 100,
  });
}

function calculateTotalStars(repos) {
  return repos.reduce((sum, repo) => sum + repo.stargazers_count, 0);
}

async function fetchTotalCommitsViaSearch() {
  const username = process.env.GH_USERNAME;
  const response = await octokit.rest.search.commits({
    q: `author:${username}`,
    headers: { Accept: "application/vnd.github.cloak-preview" },
  });
  return response.data.total_count;
}

async function updateReadme(data) {
  const template = await fs.readFile("./main.mustache", "utf8");
  const output = Mustache.render(template, data);
  await fs.writeFile("README.md", output);
}

async function main() {
  const repoData = await grabDataFromAllRepositories();
  const totalStars = calculateTotalStars(repoData);
  const totalCommits = await fetchTotalCommitsViaSearch();
  await updateReadme({ totalStars, totalCommits });
}

main();
