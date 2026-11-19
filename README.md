# cv-check

Terminal runner for the CV cross-check. It reads the newest `Joel_Silva_CV` file in `~/Documents/SOT`, starts a local Cursor agent on your plan, and prints the match report.

It does not submit applications.

## Setup

```bash
cd ~/Projects/cv-check
npm install
npm run build
```

Create a user API key at [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations) and export it:

```bash
export CURSOR_API_KEY="cursor_..."
```

Optional, so `cv-check` works from any directory:

```bash
npm link
```

## Web interface

```bash
npm run web
```

This builds the project, starts a local server at [http://localhost:4321](http://localhost:4321), and opens it in your browser. Paste the job link and press **Check**. The page shows progress, the match report, and buttons to open the tailored PDF or show it in Finder. When the model wants to drop facts to keep the CV on one page, the page asks you to tick which ones it may remove.

The server reads `CURSOR_API_KEY` from your shell or from a `.env` file in this folder:

```bash
echo 'CURSOR_API_KEY=cursor_...' > .env
```

Options such as the model, running again for a job that is already tracked, and pasting the description for a login-walled page are under **Options**. The server only accepts requests from this machine. Use `--port 4322` or `--no-open` after `npm run web --` to change the port or skip opening the browser.

## Web interface in Docker (Colima)

```bash
echo 'CURSOR_API_KEY=cursor_...' > .env
colima start
docker compose up -d --build
```

Open [http://localhost:4321](http://localhost:4321). The container restarts on its own whenever Colima starts, so after a reboot `colima start` is enough. `docker compose down` stops it for good; run `docker compose up -d --build` again after changing the code or `.env`.

`~/Documents` is mounted at the same path inside the container, so the CV, tracker, and job folders are the ones on your Mac. The image uses Chromium with Liberation Sans in place of Helvetica, so the PDF can fit a little differently than when run on macOS. **Show in Finder** is hidden in Docker; use **Open tailored CV (PDF)** instead.

## Run in the terminal

```bash
cv-check "https://example.com/jobs/123"
```

Or, without linking:

```bash
npm run cv-check -- "https://example.com/jobs/123"
```

The report prints in the terminal. The default model is Grok 4.7 (`grok-4.7`).

- **Apply** or **Maybe apply:** a tailored PDF is written next to the match report in `~/Documents/<Company Role>/Joel_Silva_CV.pdf`. Wording is limited to facts already in the source CV. City, country, and work arrangement (hybrid, remote, on-site, and similar) are left off. The PDF is one A4 page, filled from top to bottom. If a fact has to be removed to keep it on that page, the command asks you to approve each removal first.
- **Skip:** no PDF and no rewrite tips. A rewrite would not create the missing experience.

The local tracker CSV is updated only when a tailored PDF is written. On Skip, or when no tailored CV comes out of the run (no draft, or it does not fit on one page), the job is not added to the CSV and no job folder is created; the report is still shown. **Date** and **Status** stay empty for you to fill if you apply. The Google Sheet is not updated; this program cannot write to Sheets, so the row is logged in `~/Documents/SOT/Spreadsheet of doom & despair - main.csv`.

If that URL is already in the CSV, the command stops and prints the earlier recommendation. Run again with `--force` to add another row.

```bash
cv-check "https://example.com/jobs/123" --force
cv-check "https://example.com/jobs/123" --description ./posting.txt
cv-check "https://example.com/jobs/123" --model grok-4.7
```

`--force-cv` always writes a tailored PDF and adds the row. It applies on Skip, when the draft is sparse, when the model removed facts you did not approve after its retries, and when the CV does not fit on one page (it runs onto a second page instead). It also implies `--force`. The recommendation stays honest. The CV still uses only facts from your source CV, and it still never applies for you. In the web interface this is the **Always write a tailored CV** checkbox under **Options**.

```bash
cv-check "https://example.com/jobs/123" --force-cv
```

`--description` is for pages that are login-walled. Pass a text file with the posting. The URL is still required.
