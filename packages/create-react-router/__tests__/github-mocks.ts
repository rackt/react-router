import fsp from "node:fs/promises";
import * as path from "node:path";
import { http } from "msw";
import type { setupServer } from "msw/node";
import invariant from "tiny-invariant";

type RequestHandler = Parameters<typeof setupServer>[0];

async function isDirectory(d: string) {
  try {
    return (await fsp.lstat(d)).isDirectory();
  } catch {
    return false;
  }
}
async function isFile(d: string) {
  try {
    return (await fsp.lstat(d)).isFile();
  } catch {
    return false;
  }
}

type GHContentsDescription = {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: "dir" | "file";
  _links: {
    self: string;
    git: string;
    html: string;
  };
};

type GHContent = {
  sha: string;
  node_id: string;
  size: number;
  url: string;
  content: string;
  encoding: "base64";
};

let sendTarball = async (args: { owner: string; repo: string }) => {
  let { owner, repo } = args;
  invariant(typeof owner === "string", "owner must be a string");
  invariant(typeof repo === "string", "repo must be a string");

  let pathToTarball: string;
  if (owner === "remix-run" && repo === "react-router-templates") {
    pathToTarball = path.join(__dirname, "fixtures", "templates-repo.tar.gz");
  } else if (owner === "fake-react-router-tester" && repo === "nested-dir") {
    pathToTarball = path.join(__dirname, "fixtures", "nested-dir-repo.tar.gz");
  } else {
    pathToTarball = path.join(__dirname, "fixtures", "template.tar.gz");
  }

  let fileBuffer = await fsp.readFile(pathToTarball);

  return new Response(fileBuffer, {
    headers: {
      "Content-Type": "application/x-gzip",
    },
  });
};

let githubHandlers: Array<RequestHandler> = [
  http.head(
    `https://github.com/remix-run/react-router/tree/main/:type/:name`,
    () => {
      return new Response();
    }
  ),
  http.head(
    `https://github.com/remix-run/examples/tree/main/:type/:name`,
    () => {
      return new Response();
    }
  ),
  http.head<{ status: string }>(
    `https://github.com/error-username/:status`,
    ({ params }) => {
      return new Response(null, { status: Number(params.status) });
    }
  ),
  http.head(`https://github.com/:owner/:repo`, () => {
    return new Response();
  }),
  http.head<{ status: string }>(
    `https://api.github.com/repos/error-username/:status`,
    ({ params }) => {
      return new Response(null, { status: Number(params.status) });
    }
  ),
  http.head(
    `https://api.github.com/repos/private-org/private-repo`,
    ({ request }) => {
      let status =
        request.headers.get("Authorization") === "token valid-token"
          ? 200
          : 404;
      return new Response(null, { status });
    }
  ),
  http.head(`https://api.github.com/repos/:owner/:repo`, () => {
    return new Response();
  }),
  http.head(`https://github.com/:owner/:repo/tree/:branch/:path*`, () => {
    return new Response();
  }),
  http.get<{ owner: string; repo: string }>(
    `https://api.github.com/repos/:owner/:repo/git/trees/:branch`,
    async ({ params }) => {
      let { owner, repo } = params;

      return Response.json({
        sha: "7d906ff5bbb79401a4a8ec1e1799845ed502c0a1",
        url: `https://api.github.com/repos/${owner}/${repo}/trees/7d906ff5bbb79401a4a8ec1e1799845ed502c0a1`,
        tree: [
          {
            path: "package.json",
            mode: "040000",
            type: "blob",
            sha: "a405cd8355516db9c96e1467fb14b74c97ac0a65",
            size: 138,
            url: `https://api.github.com/repos/${owner}/${repo}/git/blobs/a405cd8355516db9c96e1467fb14b74c97ac0a65`,
          },
          {
            path: "template",
            mode: "040000",
            type: "tree",
            sha: "3f350a670e8fefd58535a9e1878539dc19afb4b5",
            url: `https://api.github.com/repos/${owner}/${repo}/trees/3f350a670e8fefd58535a9e1878539dc19afb4b5`,
          },
        ],
      });
    }
  ),
  http.get<{ owner: string; repo: string; path: string }>(
    `https://api.github.com/repos/:owner/:repo/contents/:path`,
    async ({ request, params }) => {
      let { owner, repo } = params;
      if (typeof params.path !== "string") {
        throw new Error("params.path must be a string");
      }
      let contentsPath = decodeURIComponent(params.path).trim();
      let isMockable = owner === "remix-run" && repo === "react-router";

      if (!isMockable) {
        let message = `Attempting to get content description for unmockable resource: ${owner}/${repo}/${contentsPath}`;
        console.error(message);
        throw new Error(message);
      }

      let localPath = path.join(__dirname, "../../..", contentsPath);
      let isLocalDir = await isDirectory(localPath);
      let isLocalFile = await isFile(localPath);

      if (!isLocalDir && !isLocalFile) {
        return Response.json(
          {
            message: "Not Found",
            documentation_url:
              "https://docs.github.com/rest/reference/repos#get-repository-content",
          },
          { status: 404 }
        );
      }

      if (isLocalFile) {
        let encoding = "base64" as const;
        let content = await fsp.readFile(localPath, { encoding: "utf-8" });
        return Response.json({
          content: Buffer.from(content, "utf-8").toString(encoding),
          encoding,
        });
      }

      let dirList = await fsp.readdir(localPath);
      let url = new URL(request.url);

      let contentDescriptions = await Promise.all(
        dirList.map(async (name): Promise<GHContentsDescription> => {
          let relativePath = path.join(contentsPath, name);
          // NOTE: this is a cheat-code so we don't have to determine the sha of the file
          // and our sha endpoint handler doesn't have to do a reverse-lookup.
          let sha = relativePath;
          let fullPath = path.join(localPath, name);
          let isDir = await isDirectory(fullPath);
          let size = isDir ? 0 : (await fsp.stat(fullPath)).size;
          return {
            name,
            path: relativePath,
            sha,
            size,
            url: `https://api.github.com/repos/${owner}/${repo}/contents/${contentsPath}?${url.searchParams}`,
            html_url: `https://github.com/${owner}/${repo}/tree/main/${contentsPath}`,
            git_url: `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}`,
            download_url: null,
            type: isDir ? "dir" : "file",
            _links: {
              self: `https://api.github.com/repos/${owner}/${repo}/contents/${contentsPath}${url.searchParams}`,
              git: `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}`,
              html: `https://github.com/${owner}/${repo}/tree/main/${contentsPath}`,
            },
          };
        })
      );

      return Response.json(contentDescriptions);
    }
  ),
  http.get<{ owner: string; repo: string; sha: string }>(
    `https://api.github.com/repos/:owner/:repo/git/blobs/:sha`,
    async ({ params }) => {
      let { owner, repo } = params;
      if (typeof params.sha !== "string") {
        throw new Error("params.sha must be a string");
      }
      let sha = decodeURIComponent(params.sha).trim();
      // if the sha includes a "/" that means it's not a sha but a relativePath
      // and therefore the client is getting content it got from the local
      // mock environment, not the actual github API.
      if (!sha.includes("/")) {
        let message = `Attempting to get content for sha, but no sha exists locally: ${sha}`;
        console.error(message);
        throw new Error(message);
      }

      // NOTE: we cheat a bit and in the contents/:path handler, we set the sha to the relativePath
      let relativePath = sha;
      let fullPath = path.join(__dirname, "..", relativePath);
      let encoding = "base64" as const;
      let size = (await fsp.stat(fullPath)).size;
      let content = await fsp.readFile(fullPath, { encoding: "utf-8" });

      let resource: GHContent = {
        sha,
        node_id: `${sha}_node_id`,
        size,
        url: `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`,
        content: Buffer.from(content, "utf-8").toString(encoding),
        encoding,
      };

      return Response.json(resource);
    }
  ),
  http.get<{ owner: string; repo: string; path?: string[] }>(
    `https://api.github.com/repos/:owner/:repo/contents{/*path}`,
    async ({ params }) => {
      let { owner, repo } = params;

      let relativePath = params.path;
      if (typeof relativePath !== "string") {
        throw new Error("params.path must be a string");
      }
      let fullPath = path.join(__dirname, "..", relativePath);
      let encoding = "base64" as const;
      let size = (await fsp.stat(fullPath)).size;
      let content = await fsp.readFile(fullPath, { encoding: "utf-8" });
      let sha = `${relativePath}_sha`;

      let resource: GHContent = {
        sha,
        node_id: `${params.path}_node_id`,
        size,
        url: `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`,
        content: Buffer.from(content, "utf-8").toString(encoding),
        encoding,
      };

      return Response.json(resource);
    }
  ),
  http.get<{ branch: string }>(
    `https://codeload.github.com/private-org/private-repo/tar.gz/:branch`,
    ({ request }) => {
      if (request.headers.get("Authorization") !== "token valid-token") {
        return new Response(null, { status: 404 });
      }
      return sendTarball({ owner: "private-org", repo: "private-repo" });
    }
  ),
  http.get<{ owner: string; repo: string; branch: string }>(
    `https://codeload.github.com/:owner/:repo/tar.gz/:branch`,
    ({ params }) => {
      return sendTarball({ owner: params.owner, repo: params.repo });
    }
  ),
  http.get(
    `https://api.github.com/repos/private-org/private-repo/tarball`,
    ({ request }) => {
      if (request.headers.get("Authorization") !== "token valid-token") {
        return new Response(null, { status: 404 });
      }
      return sendTarball({ owner: "private-org", repo: "private-repo" });
    }
  ),
  http.get<{ tag: string }>(
    `https://api.github.com/repos/private-org/private-repo/releases/tags/:tag`,
    ({ request, params }) => {
      if (request.headers.get("Authorization") !== "token valid-token") {
        return new Response(null, { status: 404 });
      }
      let { tag } = params;
      return Response.json({
        assets: [
          {
            browser_download_url: `https://github.com/private-org/private-repo/releases/download/${tag}/template.tar.gz`,
            id: "working-asset-id",
          },
        ],
      });
    }
  ),
  http.get(
    `https://api.github.com/repos/private-org/private-repo/releases/assets/working-asset-id`,
    ({ request }) => {
      if (request.headers.get("Authorization") !== "token valid-token") {
        return new Response(null, { status: 404 });
      }
      return sendTarball({ owner: "private-org", repo: "private-repo" });
    }
  ),
  http.get<{ status: string }>(
    `https://api.github.com/repos/error-username/:status/tarball`,
    ({ params }) => {
      return new Response(null, { status: Number(params.status) });
    }
  ),
  http.get<{ owner: string; repo: string }>(
    `https://api.github.com/repos/:owner/:repo/tarball`,
    ({ params }) => {
      return sendTarball({ owner: params.owner, repo: params.repo });
    }
  ),
  http.get(`https://api.github.com/repos/:repo*`, () => {
    return Response.json({ default_branch: "main" });
  }),
];

export { githubHandlers };
