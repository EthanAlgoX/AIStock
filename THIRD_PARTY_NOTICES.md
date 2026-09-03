# Third-Party Notices

This repository includes software derived from third-party projects. The
following notice applies to the files identified below.

## AlphaSift

- Project: AlphaSift
- Source: https://github.com/ZhuLinsen/alphasift
- Referenced revision: `9f522747caafd3c0b1ddb7e14d5cf44c8580b6cf`
- License: Apache License 2.0
- Included and modified files: `src/services/screening/**/*.py` and
  `src/services/screening/strategies/*.yaml`
- License copy: `src/services/screening/LICENSE`

The included code has been modified and integrated into
`daily_stock_analysis`. Per-file headers identify the source revision and
modification status.

## Financial macro Agent Skills

- Project: `gauss314/skills` (`fred-macro`)
- Source: https://github.com/gauss314/skills
- License: MIT
- Adaptation: FRED series selection and Agent analysis contract in
  `strategies/global-macro-review/SKILL.md` and `data_provider/fred_macro_fetcher.py`.

- Project: `openclaw-data-china-stock` (`china-macro-analyst`)
- Source: https://github.com/shaoxing-xie/openclaw-data-china-stock
- License: MIT
- Adaptation: China macro reasoning contract in
  `strategies/a-share-macro-review/SKILL.md`.

- Project: `ApocData-skill`
- Source: https://github.com/ApocData/ApocData-skill
- License: Apache License 2.0
- Adaptation: documented public macro API contract in
  `data_provider/apocdata_macro_fetcher.py`.

The upstream executable scripts are not bundled or invoked. Network access is
reimplemented through the project's read-only data-source and Tool boundary.
