import { pbkdf2, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import readline from "node:readline";

const derive = promisify(pbkdf2);
const iterations = 600_000;
const password = await readPassword("Admin password: ");
if (password.length < 12) {
  process.stderr.write("Password must contain at least 12 characters.\n");
  process.exitCode = 1;
} else {
  const salt = randomBytes(16);
  const key = await derive(password, salt, iterations, 32, "sha256");
  process.stdout.write(
    `pbkdf2-sha256$${iterations}$${salt.toString("base64url")}$${key.toString("base64url")}\n`,
  );
}

function readPassword(prompt) {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      let value = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        value += chunk;
      });
      process.stdin.on("end", () => resolve(value.replace(/[\r\n]+$/, "")));
    });
  }
  return new Promise((resolve, reject) => {
    let value = "";
    readline.emitKeypressEvents(process.stdin);
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = () => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onKeypress = (character, key) => {
      if (key?.ctrl && key.name === "c") {
        finish();
        reject(new Error("Password entry cancelled"));
        return;
      }
      if (key?.name === "return" || key?.name === "enter") {
        finish();
        resolve(value);
        return;
      }
      if (key?.name === "backspace") {
        value = Array.from(value).slice(0, -1).join("");
        return;
      }
      if (!key?.ctrl && !key?.meta && character) value += character;
    };
    process.stdin.on("keypress", onKeypress);
  });
}
