# Clear45

**Pay every small supplier before the legal deadline.**

Clear45 is a small business that runs on Claude, with no AI inside the app.

- **Claude does the thinking.** A finance person drops a supplier invoice into their own Claude and types "log this bill in Clear45". Claude reads the invoice and sends the details to this app.
- **The app does everything else.** It checks the details, saves the bill, works out the legal payment deadline with fixed rules, shows a red, amber or green countdown, lets a person edit and approve, and produces the compliance spreadsheet.

## The problem it solves

Indian law (MSMED Act 2006, sections 15 and 16) says a buyer must pay a micro or small supplier within **15 days** of accepting the goods or services, or within the agreed period, **capped at 45 days**, when there is a written agreement. If the buyer pays late:

- it can deduct that expense from its taxable income only in the year it actually pays (Section 43B(h) of the Income-tax Act 1961 up to 31 March 2026; Section 37(2)(g) of the Income-tax Act 2025 from 1 April 2026);
- it owes the supplier compound interest at three times the RBI bank rate;
- a company must report it in the half-yearly Form MSME-1.

Most finance teams track this in a spreadsheet. Clear45 tracks it bill by bill.

## How the assignment's four rules are met

| Rule in the brief | How Clear45 meets it |
|---|---|
| Work from Claude | Claude connects through MCP (Model Context Protocol, the standard that lets Claude call actions in another app). Typing "log this bill" creates a real bill in the database. |
| Let a person edit it | Sign in to the web app, open the bill Claude created, change any field, approve it, mark it paid. Every change is saved and shown in the activity log as "Claude" or the person's name. |
| Be live on the internet | Runs on Vercel (hosting) with a Postgres database on Neon. Steps below. |
| No AI inside | The only installed package is `pg`, the database driver. There is no AI key and no AI library. See "How to check there is no AI inside". |

It is not a website builder or an online shop.

## What is in the box

**Five actions Claude can call**

| Action | What it does | Changes data? |
|---|---|---|
| `clear45_create_bill` | Saves an invoice as a bill and returns the legal due date, days left and the rule applied. A repeat of the same supplier and invoice number is not saved twice. | Yes |
| `clear45_list_bills` | Lists bills, most urgent first, with filters such as overdue or due this week. | No |
| `clear45_update_bill` | Corrects fields and recalculates the deadline. An approved bill goes back to "Needs review". | Yes |
| `clear45_mark_paid` | Records the payment date and whether it was on time or late. | Yes |
| `clear45_export_register` | Returns the half-year position in the shape of Form MSME-1. | No |

**The web app**

- Dashboard with totals: past the legal deadline, due within 7 days, on track, needs review.
- Bills table with a countdown, filters and search. It refreshes every few seconds, so a bill created in Claude appears while you watch.
- Bill panel: every field is editable, and the due date is recalculated as you type. Each bill shows its working, for example `Accepted 5 Nov 2026 + 45 days (written agreement) = due 20 Dec 2026`.
- Controls: a bill Claude creates is always "Needs review". Only a person can approve, and only after the acceptance date and the supplier's MSME category are confirmed.
- Activity log on every bill: who created it, who changed what, from which value to which value.
- Export: a full bill register and a Form MSME-1 working sheet, as CSV files (they open in Excel or Google Sheets).
- "Connect Claude" pop-up with the connector link, three steps, sample invoices and example requests.
- "Reset demo data" button, so each reviewer can start from the same sample bills.

## Put it live (about 20 minutes, free)

You need three free accounts: GitHub (stores the code), Neon (the database) and Vercel (the hosting).

**1. Put the code on GitHub**

1. On github.com, create a new repository called `clear45`. Make it public so reviewers can check there is no AI inside.
2. Upload every file and folder in this project (use "uploading an existing file" on the new repository page and drag the contents in), then commit.

**2. Create the database on Neon**

1. On neon.com, create a project. Pick the region closest to your reviewers (Singapore is a good choice).
2. Copy the **pooled connection string**. It starts with `postgresql://` and ends with `sslmode=require`. Keep it private.

You do not need to create any tables. The app creates them and loads the sample bills the first time it runs.

**3. Deploy on Vercel**

1. On vercel.com, sign in with GitHub, choose **Add New > Project** and import the `clear45` repository. Leave the framework setting as "Other". No build command is needed.
2. Before deploying, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `DATABASE_URL` | The Neon connection string from step 2 |
| `MCP_TOKEN` | A long random secret, at least 32 characters. This becomes the key inside the Claude link. |
| `APP_USERNAME` | The test username, for example `demo` |
| `APP_PASSWORD` | The test password you will give reviewers |
| `SHOW_DEMO_LOGIN` | `1` to show a "Fill in the demo login" button on the sign-in page. Leave it out to hide the login. |

3. Press **Deploy**. Your app is live at the production address Vercel shows, for example `https://clear45.vercel.app`. Share that address, not a preview address.

After this, every change pushed to GitHub goes live automatically.

**4. Check it works (5 minutes)**

1. Open the address and sign in. You should see 12 sample bills and **no** yellow "Test mode" banner. A banner means `DATABASE_URL` is missing.
2. Press **Connect Claude** and copy the link.
3. Connect it to Claude (next section), drop in `sample-invoice-1-on-track.pdf` and type "Log this bill in Clear45".
4. Watch the bill appear on the dashboard, open it, change the acceptance date and save.

## Connect it to Claude (the steps to give reviewers)

1. Sign in to the Clear45 app, press **Connect Claude** and copy the link. It looks like `https://<your-app>/api/mcp?key=<secret>`.
2. In Claude (claude.ai or the desktop app), open **Customize**, then **Connectors**, press **+** and choose **Add custom connector**.
3. Name it `Clear45`, paste the link and press **Add**. No sign-in is asked for.
4. Start a new chat, switch the Clear45 connector on, attach one of the sample invoices from the sign-in page and type: **Log this bill in Clear45.**

Other things to try:

- "Which Clear45 bills must we pay this week, and which are already overdue?"
- "Set the acceptance date of the Malabar Coir Exports bill to 1 November 2026."
- "Give me the Clear45 MSME-1 summary for this half-year as a short note for my CFO."

Note for people on Claude's free plan: it allows one custom connector at a time.

## How to check there is no AI inside

1. Open `package.json`. The only dependency is `pg`, the Postgres database driver.
2. Search the code for `openai`, `anthropic`, `gemini` or `langchain`. They appear only in this README and on the `/trust` page, where the words are named.
3. The hosting settings hold five values: the database address, the connector key, the demo username and password, and the demo-login switch. None is an AI key.

The live app repeats this at `/trust`.

## Run it on your own computer

Needs Node.js 20 or newer. Nothing to install for a local trial: without `DATABASE_URL` the app keeps data in memory.

```
node dev-server.mjs      # then open http://localhost:3000  (login: demo / clear45-demo)
node --test              # runs the automated checks
```

## Automated checks

`node --test` runs 26 checks:

- **Deadline rules** (`test/rules.test.js`): the four worked examples (for example, accepted 10 March 2026 with 45 days agreed is due 24 April 2026), the 45-day cap, acceptance date versus invoice date, who is not covered, the colour thresholds, on-time versus late payment, leap years and year ends.
- **Claude connection** (`test/mcp.test.js`): the connection handshake, each of the five actions, duplicate protection, error messages Claude can act on, the approval control, the MSME-1 totals and safe spreadsheet export.

## Where things are

```
api/          one file per web address (the Claude connection is api/mcp.js)
lib/rules.js  the deadline rules. India is one "rule pack"; another country would be a second file.
lib/service.js  everything that can happen to a bill; used by both Claude and the web screens
lib/mcp.js    the five actions Claude can call
lib/store.js  the database
lib/seed.js   the sample bills
public/       the web screens and the three sample invoices
test/         the automated checks
```

## What I chose not to build, and why

The brief says one thing that works well beats many things that half work.

- **Making payments.** Clear45 tells you what to pay and by when. Paying belongs in a payments platform.
- **Storing the invoice file.** Claude passes the details it read, not the file. The human review step covers misreads.
- **Email reminders, several companies in one account, part-payments, TReDS payments.** All are natural next steps.
- **Full sign-in for the Claude link.** The demo uses a secret key inside the link. A production version would use OAuth, the standard "Sign in with..." flow.
- **Other countries.** The rules sit in one file so that a second rule pack, such as Australia's payment-times reporting, can be added without touching the rest.

## Known limits

- Decision-support only, not tax or legal advice. Confirm each supplier's MSME status and acceptance dates with a chartered accountant.
- Traders are treated as outside the rule, following the common reading of the MSME Office Memorandum of 2 July 2021. Some advisers read this differently.
- Advisers also differ on exactly when Form MSME-1 must be filed. The working sheet shows all four columns either way.
- Section references switch on the acceptance date: before 1 April 2026 the 1961 Act, from then the 2025 Act.
- Dates use India time.
