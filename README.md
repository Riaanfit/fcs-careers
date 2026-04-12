# FCS Careers

Static careers site for `careers.fitzgeraldcreativestudios.co.za`.

## Stack
- HTML/CSS/JS frontend
- `data/jobs.json` as the live data source
- Node updater script for pulling jobs from public APIs
- GitHub Actions scheduled refresh + FTP deploy to Afrihost

## Quick start
1. Put the project in GitHub.
2. Add GitHub secrets:
   - `FTP_SERVER`
   - `FTP_USERNAME`
   - `FTP_PASSWORD`
3. Edit `data/company-boards.json` to add or remove Greenhouse and Lever companies.
4. Run locally:
   - `npm install`
   - `npm run update:jobs`
5. Open `index.html` with a local static server.

## Notes
- Remotive listings should keep source attribution visible.
- Not every company slug will always be valid. Replace starter boards with the companies you want to track.
- The site is designed to be static, fast, and FTP-friendly.
