/**
 * Popup UI — minimal unlock/lock controls.
 *
 * Avoids React to keep the extension bundle small. Calls into the service
 * worker directly via chrome.runtime.getBackgroundPage equivalent: in MV3
 * we use chrome.runtime.sendMessage for the queries and chrome.runtime
 * direct method calls aren't a thing — we re-issue the API calls here.
 *
 * For simplicity in this skeleton, the popup posts a message to the SW
 * which performs unlock. Production-grade flow would use a dedicated
 * unlock message kind; here we keep it inline for clarity.
 */

const root = document.getElementById("root")!;

interface Status {
  locked: boolean;
  email: string | null;
}

async function getStatus(): Promise<Status> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ kind: "vault:status" }, (resp) => {
      if (resp && resp.kind === "status") {
        resolve({ locked: resp.locked, email: resp.email });
      } else {
        resolve({ locked: true, email: null });
      }
    });
  });
}

function renderUnlocked(status: Status): void {
  root.innerHTML = "";
  const h1 = document.createElement("h1");
  h1.textContent = "Vault unlocked";
  const p = document.createElement("p");
  p.className = "status";
  p.textContent = `Signed in as ${status.email ?? "(unknown)"}`;
  const btn = document.createElement("button");
  btn.textContent = "Lock vault";
  btn.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ kind: "vault:lock" }).then(() => render());
  });
  root.append(h1, p, btn);
}

function renderLocked(): void {
  root.innerHTML = "";
  const h1 = document.createElement("h1");
  h1.textContent = "Unlock Passman";

  const emailLabel = document.createElement("label");
  emailLabel.textContent = "Email";
  const emailInput = document.createElement("input");
  emailInput.type = "email";
  emailInput.required = true;
  emailLabel.appendChild(emailInput);

  const pwLabel = document.createElement("label");
  pwLabel.textContent = "Master password";
  const pwInput = document.createElement("input");
  pwInput.type = "password";
  pwInput.required = true;
  pwLabel.appendChild(pwInput);

  const err = document.createElement("p");
  err.className = "error";

  const btn = document.createElement("button");
  btn.textContent = "Unlock";
  btn.addEventListener("click", () => {
    btn.disabled = true;
    err.textContent = "";
    void chrome.runtime
      .sendMessage({
        kind: "vault:unlock",
        email: emailInput.value,
        password: pwInput.value,
      })
      .then((resp: { ok?: boolean; error?: string } | undefined) => {
        if (resp?.ok) {
          render();
        } else {
          err.textContent = resp?.error ?? "Unlock failed";
        }
        btn.disabled = false;
      })
      .catch((e: Error) => {
        err.textContent = e.message;
        btn.disabled = false;
      });
  });

  root.append(h1, emailLabel, pwLabel, err, btn);
}

async function render(): Promise<void> {
  const status = await getStatus();
  if (status.locked) renderLocked();
  else renderUnlocked(status);
}

void render();
