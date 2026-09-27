import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  Code2,
  FileSearch,
  Gift,
  Radar,
  RotateCcw,
  ScanLine,
} from "lucide-react";
import { UiLanguageToggle } from "../components/i18n/UiLanguageToggle";
import { useAuth } from "../contexts/AuthContext";
import { useUiLanguage } from "../contexts/UiLanguageContext";
import { HOME_COPY, HOME_EXAMPLES } from "../i18n/homeCopy";
import type { HomeCopy } from "../i18n/homeCopy";
import "./HomePage.css";

const routes = [
  "/market-intelligence",
  "/stock-research",
  "/screening",
  "/trading",
  "/trading",
];
const icons = [Radar, FileSearch, ScanLine, ChartNoAxesCombined, RotateCcw];
const repository = "https://github.com/EthanAlgoX/AIStock";
const invitation =
  "mailto:im.hanyx@gmail.com?subject=AI%20Stock%20invitation%20code%20request";
const contract =
  "THESIS: Make research-to-validation inspectable. OWN-WORLD: Porcelain, charcoal and cobalt, precise rules and restrained corners. STORY: Explore five modules, understand evidence and simulation, choose an access path. FIRST VIEWPORT: Left-aligned proposition, right introduction, full-width selectable product demonstration below. FORM: Task-led tour, candidate 3, seed 6479fc69, approved composition C.";

function DemoChart({
  copy,
  paper = false,
}: {
  copy: HomeCopy;
  paper?: boolean;
}) {
  return (
    <figure className="home-chart">
      <figcaption>
        <strong>{paper ? copy.paper : copy.historical}</strong>
        <span>{paper ? copy.paperNote : copy.historyNote}</span>
      </figcaption>
      <svg
        viewBox="0 0 600 135"
        role="img"
        aria-label={copy.chartLabel}
        preserveAspectRatio="none"
      >
        <path d="M0 25H600 M0 65H600 M0 105H600" className="home-gridline" />
        <path
          d={
            paper
              ? "M0 100L30 95L60 101L90 85L120 91L150 84L180 89L210 72L240 78L270 80L300 60L330 66L360 59L390 69L420 48L450 54L480 42L510 52L540 34L570 39L600 28"
              : "M0 100L25 90L50 102L75 82L100 90L125 69L150 82L175 78L200 57L225 66L250 77L275 59L300 70L325 44L350 49L375 32L400 47L425 64L450 56L475 39L500 45L525 22L550 36L575 27L600 31"
          }
          className="home-curve"
        />
        {!paper && (
          <g fill="currentColor" className="home-signal-markers">
            <circle cx="275" cy="59" r="4" />
            <circle cx="425" cy="64" r="4" />
            <circle cx="550" cy="36" r="4" />
          </g>
        )}
      </svg>
      <div className="home-chart-axis">
        <span>{copy.chartStart}</span>
        <span>{copy.example}</span>
        <span>{copy.chartEnd}</span>
      </div>
    </figure>
  );
}

export default function HomePage() {
  const { language } = useUiLanguage();
  const copy = HOME_COPY[language];
  const example = HOME_EXAMPLES[language];
  const { loggedIn, authEnabled, isLoading, loadError, registrationMode } =
    useAuth();
  const [active, setActive] = useState(3);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const commentRef = useRef<HTMLDivElement>(null);
  const enter =
    loggedIn || (!isLoading && !loadError && !authEnabled)
      ? "/overview"
      : "/login?redirect=%2Foverview";
  const workspaceAvailable =
    loggedIn || (!isLoading && !loadError && !authEnabled);
  const canRegister =
    !isLoading && !loadError && authEnabled && registrationMode !== "closed";
  const join = canRegister
    ? "/login?mode=register&redirect=%2Foverview"
    : enter;
  useEffect(() => {
    const tab = tabRefs.current[active];
    const parent = tab?.parentElement;
    if (tab && parent && parent.scrollWidth > parent.clientWidth) {
      parent.scrollLeft =
        tab.offsetLeft -
        parent.offsetLeft -
        (parent.clientWidth - tab.clientWidth) / 2;
    }
  }, [active, language]);
  useEffect(() => {
    document.title = `AI Stock · ${copy.intro}`;
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    const previous = meta?.content;
    if (meta) meta.content = copy.description;
    return () => {
      if (meta && previous !== undefined) meta.content = previous;
    };
  }, [copy]);
  useEffect(() => {
    const comment = document.createComment(contract);
    const host = commentRef.current;
    host?.prepend(comment);
    return () => comment.remove();
  }, []);
  const lists = [
    copy.radarRows,
    copy.researchRows,
    copy.screeningRows,
    copy.recordRows,
    copy.reviewRows,
  ];
  const titles = [
    copy.radarTitle,
    copy.researchEvidence,
    copy.screeningCriteria,
    copy.records,
    copy.reviewTitle,
  ];

  return (
    <div className="home-page" ref={commentRef}>
      <a className="home-skip" href="#home-main">
        {copy.skip}
      </a>
      <header className="home-header">
        <Link className="home-brand" to="/" aria-label="AI Stock">
          <ChartNoAxesCombined aria-hidden size={26} />
          <span>AI Stock</span>
        </Link>
        <nav aria-label={copy.navProduct}>
          <a href="#product">{copy.navProduct}</a>
          <a href="#workflow">{copy.navWorkflow}</a>
          <a href="#faq">{copy.navFaq}</a>
        </nav>
        <div className="home-header-actions">
          <UiLanguageToggle />
          <Link className="home-small-button" to={enter}>
            {workspaceAvailable ? copy.workspace : copy.login}
            <ArrowUpRight size={15} aria-hidden />
          </Link>
        </div>
      </header>
      <main id="home-main">
        <section className="home-hero home-wrap" aria-labelledby="home-title">
          <div>
            <h1 id="home-title">{copy.title}</h1>
            <p className="home-lead">{copy.intro}</p>
            <div className="home-actions">
              <Link className="home-primary" to={enter}>
                {loggedIn ? copy.workspace : copy.start}
                <ArrowRight size={18} aria-hidden />
              </Link>
              <Link className="home-secondary" to="/try">
                {copy.demo}
              </Link>
            </div>
          </div>
          <div className="home-hero-aside">
            <p>{copy.description}</p>
            <div className="home-market-label">{copy.markets}</div>
            <ul className="home-markets">
              {copy.marketLabels.map((label, index) => (
                <li key={label}>
                  <span aria-hidden>{["CN", "HK", "US", "₿"][index]}</span>
                  {label}
                </li>
              ))}
            </ul>
            <Link to="/market-intelligence" className="home-text-link">
              {copy.moreMarkets}
              <ArrowUpRight size={14} aria-hidden />
            </Link>
          </div>
        </section>
        <section
          id="product"
          className="home-product home-wrap"
          aria-label={copy.navProduct}
        >
          <div
            className="home-tabs"
            role="tablist"
            aria-label={copy.navProduct}
          >
            {copy.moduleLabels.map((label, index) => {
              const Icon = icons[index];
              return (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  id={`home-tab-${index}`}
                  aria-controls="home-demo-panel"
                  aria-selected={active === index}
                  tabIndex={active === index ? 0 : -1}
                  ref={(el) => {
                    tabRefs.current[index] = el;
                  }}
                  onClick={() => setActive(index)}
                  onKeyDown={(event) => {
                    let next = index;
                    if (event.key === "ArrowRight") next = (index + 1) % 5;
                    else if (event.key === "ArrowLeft") next = (index + 4) % 5;
                    else if (event.key === "Home") next = 0;
                    else if (event.key === "End") next = 4;
                    else return;
                    event.preventDefault();
                    setActive(next);
                    tabRefs.current[next]?.focus();
                  }}
                >
                  <Icon size={23} aria-hidden />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
          <div
            id="home-demo-panel"
            role="tabpanel"
            aria-labelledby={`home-tab-${active}`}
            tabIndex={0}
            className="home-demo-panel"
          >
            <div className="home-demo-heading">
              <div>
                <p className="home-demo-label">{copy.example}</p>
                <h2>{copy.moduleDescriptions[active]}</h2>
              </div>
              <Link to={routes[active]} className="home-text-link">
                {copy.openModule}
                <ArrowUpRight size={16} aria-hidden />
              </Link>
            </div>
            {active === 3 ? (
              <div className="home-trading-demo">
                <aside className="home-strategy">
                  <ScanLine size={24} aria-hidden />
                  <p>{copy.strategyLabel}</p>
                  <h3>{example.asset}</h3>
                  <div className="home-rule-list">
                    {[example.rule, example.limit].map((row) => (
                      <p key={row}>
                        <Check size={15} aria-hidden />
                        {row}
                      </p>
                    ))}
                  </div>
                  <span className="home-status">{copy.example}</span>
                </aside>
                <div>
                  <DemoChart copy={copy} />
                  <DemoChart copy={copy} paper />
                </div>
                <aside className="home-decisions">
                  <h3>{copy.records}</h3>
                  {example.rows[3].map((row) => (
                    <div key={row[0]}>
                      <span className="home-record-dot" aria-hidden />
                      <span>
                        {row[1]}
                        <strong className="home-record-outcome">
                          {row[2]}
                        </strong>
                      </span>
                      <small>{row[0]}</small>
                    </div>
                  ))}
                  <p>{copy.demoNote}</p>
                </aside>
              </div>
            ) : (
              <div className="home-other-demo">
                <aside className="home-tour-context">
                  <p className="home-demo-label">{copy.example}</p>
                  <h3>{titles[active]}</h3>
                  <ul>
                    {lists[active].map((row) => (
                      <li key={row}>{row}</li>
                    ))}
                  </ul>
                </aside>
                <div className="home-example-table">
                  <table>
                    <caption>
                      {active === 1 ? example.asset : copy.moduleLabels[active]}
                    </caption>
                    <thead>
                      <tr>
                        {example.columns.map((column) => (
                          <th key={column}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {example.rows[active].map((row) => (
                        <tr key={row[0]}>
                          {row.map((cell, index) => (
                            <td key={index}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="home-demo-footnote">{copy.demoNote}</p>
          </div>
        </section>
        <section id="workflow" className="home-workflow home-wrap">
          <div className="home-section-intro">
            <h2>{copy.workflowTitle}</h2>
            <p>{copy.workflowIntro}</p>
          </div>
          <ol>
            {copy.steps.map((step, index) => (
              <li key={step}>
                <span className="home-step-number">0{index + 1}</span>
                <div>
                  <h3>{step}</h3>
                  <p>{copy.stepDetails[index]}</p>
                </div>
                {index < 2 && (
                  <ArrowRight
                    className="home-step-arrow"
                    aria-hidden
                    size={20}
                  />
                )}
              </li>
            ))}
          </ol>
        </section>
        <section id="start" className="home-start">
          <div className="home-wrap">
            <div className="home-section-intro">
              <h2>{copy.getStarted}</h2>
              <p>{copy.startIntro}</p>
            </div>
            <div className="home-start-options">
              <article>
                <Gift size={28} aria-hidden />
                <h3>{copy.inviteTitle}</h3>
                <p>{copy.inviteText}</p>
                <a className="home-primary" href={invitation}>
                  {copy.requestInvite}
                  <ArrowUpRight size={18} aria-hidden />
                </a>
              </article>
              <article>
                <Code2 size={28} aria-hidden />
                <h3>{copy.apiTitle}</h3>
                <p>{copy.apiText}</p>
                <Link className="home-secondary" to={join}>
                  {workspaceAvailable
                    ? copy.workspace
                    : canRegister
                      ? copy.register
                      : copy.login}
                  <ArrowRight size={18} aria-hidden />
                </Link>
              </article>
            </div>
            {!isLoading &&
              !loadError &&
              authEnabled &&
              registrationMode === "closed" &&
              !loggedIn && <p className="home-instance-note">{copy.closed}</p>}
            <a
              className="home-text-link home-source"
              href={`${repository}#quick-start`}
              target="_blank"
              rel="noreferrer"
            >
              {copy.selfHost}
              <ArrowUpRight size={15} aria-hidden />
            </a>
          </div>
        </section>
        <section id="faq" className="home-faq home-wrap">
          <h2>{copy.faqTitle}</h2>
          <div>
            {copy.questions.map((question, index) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={18} aria-hidden />
                </summary>
                <p>{copy.answers[index]}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <footer className="home-footer home-wrap">
        <div>
          <Link className="home-brand" to="/">
            AI Stock
          </Link>
          <p>{copy.footer}</p>
        </div>
        <div className="home-footer-links">
          <a href={repository} target="_blank" rel="noreferrer">
            {copy.source}
            <ArrowUpRight size={14} aria-hidden />
          </a>
          <Link to="/try">{copy.demo}</Link>
          <a href="#start">{copy.navStart}</a>
        </div>
        <p className="home-disclaimer">{copy.disclaimer}</p>
      </footer>
    </div>
  );
}
