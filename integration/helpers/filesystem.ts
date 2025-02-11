import fse from "fs-extra";
import stripIndent from "strip-indent";
import path from "node:path";
import url from "node:url";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
const root = path.resolve(__dirname, "../..");
const TMP_DIR = path.join(root, ".tmp/integration");

export async function writeTestFiles(
  files: Record<string, string> | undefined,
  dir: string
) {
  await Promise.all(
    Object.keys(files ?? {}).map(async (filename) => {
      let filePath = path.join(dir, filename);
      await fse.ensureDir(path.dirname(filePath));
      let file = files![filename];

      await fse.writeFile(filePath, stripIndent(file));
    })
  );
}

export async function getAllFilesInDir(dirPath: string): Promise<string[]> {
  const entries = await fse.promises.readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const resolvedPath = path.resolve(dirPath, entry.name);
      if (entry.isDirectory()) {
        return getAllFilesInDir(resolvedPath);
      } else {
        return [resolvedPath];
      }
    })
  );
  return files.flat();
}

export async function createTestDirectory() {
  let folderName = `rr-${Math.random().toString(32).slice(2)}`;
  let testDir = path.join(TMP_DIR, folderName);
  await fse.ensureDir(testDir);
  return testDir;
}
