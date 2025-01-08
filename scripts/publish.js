const path = require("path");
const { execSync } = require("child_process");

const jsonfile = require("jsonfile");
const semver = require("semver");

const rootDir = path.resolve(__dirname, "..");

/**
 * @param {*} cond
 * @param {string} message
 * @returns {asserts cond}
 */
function invariant(cond, message) {
  if (!cond) throw new Error(message);
}

/**
 * @returns {string}
 */
function getTaggedVersion() {
  let output = execSync("git tag --list --points-at HEAD").toString();
  return output.replace(/^v|\n+$/g, "");
}

/**
 * @param {string} packageName
 * @param {string|number} version
 */
async function ensureBuildVersion(packageName, version) {
  let file = path.join(rootDir, "packages", packageName, "package.json");
  let json = await jsonfile.readFile(file);
  invariant(
    json.version === version,
    `Package ${packageName} is on version ${json.version}, but should be on ${version}`
  );
}

/**
 * @param {string} packageName
 * @param {string} tag
 */
function publishBuild(packageName, tag) {
  let buildDir = path.join(rootDir, "packages", packageName);
  let args = ["--access public"];
  if (tag) {
    args.push(`--tag ${tag}`);
  }
  if (tag === "experimental" || tag === "nightly") {
    args.push(`--no-git-checks`);
  } else {
    args.push("--publish-branch release-next");
  }
  console.log();
  console.log(`  pnpm publish ${buildDir} --tag ${tag} --access public`);
  console.log();
  execSync(`pnpm publish ${buildDir} ${args.join(" ")}`, {
    stdio: "inherit",
  });
}

/**
 * @returns {Promise<1 | 0>}
 */
async function run() {
  try {
    // 0. Ensure we are in CI. We don't do this manually
    invariant(
      process.env.CI,
      `You should always run the publish script from the CI environment!`
    );

    // 1. Get the current tag, which has the release version number
    let version = getTaggedVersion();
    invariant(
      version !== "",
      "Missing release version. Run the version script first."
    );

    // 2. Determine the appropriate npm tag to use
    let tag;
    if (version.includes("experimental")) {
      tag = "experimental";
    } else if (version.includes("nightly")) {
      tag = "nightly";
    } else if (version.startsWith("7.")) {
      if (semver.prerelease(version) == null) {
        tag = "latest";
      } else {
        tag = "pre";
      }
    }

    console.log();
    console.log(`  Publishing version ${version} to npm with tag "${tag}"`);

    // 3. Ensure build versions match the release version
    await ensureBuildVersion("react-router", version);
    await ensureBuildVersion("react-router-dom", version);
    await ensureBuildVersion("react-router-dev", version);
    await ensureBuildVersion("react-router-express", version);
    await ensureBuildVersion("react-router-node", version);
    await ensureBuildVersion("react-router-serve", version);
    await ensureBuildVersion("react-router-architect", version);
    await ensureBuildVersion("react-router-cloudflare", version);
    await ensureBuildVersion("react-router-fs-routes", version);
    await ensureBuildVersion(
      "react-router-remix-routes-option-adapter",
      version
    );
    await ensureBuildVersion("create-react-router", version);

    // 4. Publish to npm
    publishBuild("react-router", tag);
    publishBuild("react-router-dom", tag);
    publishBuild("react-router-dev", tag);
    publishBuild("react-router-express", tag);
    publishBuild("react-router-node", tag);
    publishBuild("react-router-serve", tag);
    publishBuild("react-router-architect", tag);
    publishBuild("react-router-cloudflare", tag);
    publishBuild("react-router-fs-routes", tag);
    publishBuild("react-router-remix-routes-option-adapter", tag);
    publishBuild("create-react-router", tag);
  } catch (error) {
    console.log();
    console.error(`  ${error.message}`);
    console.log();
    return 1;
  }

  return 0;
}

run().then((code) => {
  process.exit(code);
});
