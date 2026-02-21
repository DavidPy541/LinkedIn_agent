import fs from "fs";

const LI_AT = process.env.LI_AT;
const JSESSIONID = process.env.JSESSIONID;
const BCOOKIE = process.env.BCOOKIE;
const BSCOOKIE = process.env.BSCOOKIE; // optional

if (!LI_AT || !JSESSIONID || !BCOOKIE) {
  console.error("Missing LI_AT, JSESSIONID or BCOOKIE in env (Codespaces secrets).");
  process.exit(1);
}

const clean = (v) => v.replace(/^"|"$/g, "");

const cookies = [
  {
    name: "li_at",
    value: clean(LI_AT),
    domain: ".linkedin.com",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  },
  {
    name: "JSESSIONID",
    value: clean(JSESSIONID),
    domain: ".linkedin.com",
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  },
  {
    name: "bcookie",
    value: clean(BCOOKIE),
    domain: ".linkedin.com",
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  },
];

if (BSCOOKIE) {
  cookies.push({
    name: "bscookie",
    value: clean(BSCOOKIE),
    domain: ".linkedin.com",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
}

const state = {
  cookies,
  origins: [],
};

fs.writeFileSync("storageState.json", JSON.stringify(state, null, 2));
console.log("✅ storageState.json created");
