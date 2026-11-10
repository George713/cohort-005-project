import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Knock templates live in `.knock/` and reach Production through review: a
// push to `main` that changes them makes CI push and commit them to Knock
// Development, then promote them to Production. The credentials that need a
// human (the CI service token, the Production keys) come from the wizard.
// These tests pin both halves together, so the workflow can't reference a
// secret the wizard never creates.

const WORKFLOW_PATH = ".github/workflows/knock-templates.yml";
const WIZARD_PATH = "scripts/setup-knock-production.sh";

type Step = {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  run?: string;
};

type Workflow = {
  on?: {
    push?: { branches?: string[]; paths?: string[] };
  };
  jobs?: Record<string, { steps?: Step[] }>;
};

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function steps(): Step[] {
  const workflow = parse(read(WORKFLOW_PATH)) as Workflow;
  return Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
}

/** The one step whose command matches, or a loud failure. */
function commandStep(pattern: RegExp): Step {
  const step = steps().find((candidate) =>
    candidate.run ? pattern.test(candidate.run) : false
  );
  if (!step) throw new Error(`no workflow step matches ${pattern}`);
  return step;
}

function commandIndex(pattern: RegExp): number {
  return steps().findIndex((step) =>
    step.run ? pattern.test(step.run) : false
  );
}

describe("the Knock templates workflow", () => {
  it("runs on a push to main that changes .knock/", () => {
    const workflow = parse(read(WORKFLOW_PATH)) as Workflow;
    expect(workflow.on?.push?.branches).toEqual(["main"]);
    expect(workflow.on?.push?.paths).toEqual([".knock/**"]);
  });

  it("does not run for a push that touches nothing in .knock/", () => {
    const workflow = parse(read(WORKFLOW_PATH)) as Workflow;
    expect(workflow.on?.push?.paths).toEqual([".knock/**"]);
    const otherTriggers = Object.keys(workflow.on ?? {}).filter(
      (trigger) => trigger !== "push"
    );
    expect(otherTriggers).toEqual([]);
  });

  it("installs the Knock CLI on a Node.js version it supports", () => {
    const setup = steps().find((step) =>
      step.uses?.startsWith("actions/setup-node@")
    );
    const nodeVersion = Number(setup?.with?.["node-version"]);
    expect(nodeVersion).toBeGreaterThanOrEqual(24);
    expect(
      steps().some((step) =>
        step.run?.includes("npm install -g @knocklabs/cli")
      )
    ).toBe(true);
  });

  it("pushes and commits the templates to Knock Development", () => {
    const { run } = commandStep(/knock push/);
    expect(run).toContain("--knock-dir=.knock");
    expect(run).toContain("--environment=development");
    expect(run).toContain("--commit");
  });

  it("promotes the committed templates to Knock Production after pushing", () => {
    const { run } = commandStep(/knock commit promote/);
    expect(run).toContain("--to=production");
    expect(commandIndex(/knock push/)).toBeLessThan(
      commandIndex(/knock commit promote/)
    );
  });

  it("authenticates both Knock commands with the service token secret", () => {
    for (const pattern of [/knock push/, /knock commit promote/]) {
      expect(commandStep(pattern).env?.KNOCK_SERVICE_TOKEN).toBe(
        "${{ secrets.KNOCK_SERVICE_TOKEN }}"
      );
    }
  });
});

describe("the batched Notification templates", () => {
  function template(workflow: string): string {
    return read(`.knock/workflows/${workflow}/in_app_feed_1/markdown_body.md`);
  }

  it("names the latest Student and counts the others in a larger enrollment batch", () => {
    const body = template("enrollment-new");

    expect(body).toContain(
      "**{{ data.studentName }}** enrolled in **{{ data.courseTitle }}**"
    );
    expect(body).toContain(
      "**{{ firstStudent.data.studentName }}** and **{{ lastStudent.data.studentName }}** enrolled in **{{ data.courseTitle }}**"
    );
    expect(body).toContain(
      "**{{ latestStudent.data.studentName }}** and {{ total_activities | minus: 1 }} others enrolled in **{{ data.courseTitle }}**"
    );
    expect(body).not.toContain("{{ total_activities }} others");
  });

  it("names the latest Student and counts the others in a larger seat batch", () => {
    const body = template("seat-claimed");

    expect(body).toContain(
      "**{{ data.studentName }}** claimed a Seat on **{{ data.courseTitle }}**"
    );
    expect(body).toContain(
      "**{{ activities[0].data.studentName }}** and **{{ activities[1].data.studentName }}** claimed Seats on **{{ data.courseTitle }}**"
    );
    expect(body).toContain(
      "**{{ data.studentName }}** and {{ total_activities | minus: 1 }} others claimed Seats on **{{ data.courseTitle }}**"
    );
    expect(body).not.toContain("{{ total_activities }} others");
  });
});

describe("the Knock production setup wizard", () => {
  const wizard = read(WIZARD_PATH);

  it("is valid bash", () => {
    const path = fileURLToPath(
      new URL("../scripts/setup-knock-production.sh", import.meta.url)
    );
    expect(() => execFileSync("bash", ["-n", path])).not.toThrow();
  });

  it("sets a stage count that matches the stages it prints", () => {
    const stages = [...wizard.matchAll(/^stage "[^"]+"$/gm)];
    const declared = [...wizard.matchAll(/^TOTAL_STAGES=(\d+)$/gm)].at(-1);
    expect(stages.length).toBeGreaterThanOrEqual(6);
    expect(Number(declared?.[1])).toBe(stages.length);
  });

  it("captures every Production value the app reads", () => {
    for (const key of [
      "KNOCK_PUBLIC_API_KEY",
      "KNOCK_SECRET_API_KEY",
      "KNOCK_SIGNING_KEY",
      "KNOCK_FEED_CHANNEL_ID",
    ]) {
      expect(wizard).toContain(`write_env ${key} "$${key}"`);
    }
  });

  it("writes the Production values to .env.production, which git ignores", () => {
    expect(wizard).toContain('ENV_FILE="${ENV_FILE:-.env.production}"');
    const ignore = read(".gitignore").split(/\r?\n/);
    expect(ignore).toContain(".env.production");
  });

  it("turns on enhanced security in Production", () => {
    expect(wizard).toMatch(/enhanced security/i);
    expect(wizard).toMatch(/Production/);
  });

  it("creates the service token CI needs as a GitHub secret", () => {
    expect(wizard).toContain('set_secret KNOCK_SERVICE_TOKEN "$KNOCK_SERVICE_TOKEN"');
  });

  it("covers every secret the workflow reads", () => {
    const secrets = [
      ...new Set(
        [...read(WORKFLOW_PATH).matchAll(/secrets\.([A-Z0-9_]+)/g)].map(
          (match) => match[1]
        )
      ),
    ];
    expect(secrets.length).toBeGreaterThan(0);
    for (const secret of secrets) {
      expect(wizard).toContain(`set_secret ${secret}`);
    }
  });

  it("keeps the CI service token out of the app's environment file", () => {
    expect(wizard).not.toContain("write_env KNOCK_SERVICE_TOKEN");
  });

  it("deletes the prototype-test workflow left over from setup", () => {
    expect(wizard).toContain("prototype-test");
  });
});
