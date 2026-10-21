import React, {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { animate, useInView } from "motion/react";
import styles from "./stats-band.module.css";

const enter = [0.16, 1, 0.3, 1];
const STAGGER = 0.09;

const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (onChange) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

function useReducedMotionSafe() {
  return useSyncExternalStore(
    subscribeReduced,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(REDUCE).matches : false),
    () => false
  );
}

function useFormat(stat, locale = "en-US") {
  return useMemo(() => {
    const decimals = stat.decimals ?? 0;
    const digits = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      numberingSystem: "latn",
    });
    if (stat.notation !== "compact") {
      return { unit: "", format: (value) => digits.format(value) };
    }
    const size = Math.abs(stat.value);
    const scale =
      size >= 1e12
        ? 1e12
        : size >= 1e9
        ? 1e9
        : size >= 1e6
        ? 1e6
        : size >= 1e3
        ? 1e3
        : 1;
    const unit =
      scale === 1
        ? ""
        : (new Intl.NumberFormat(locale, { notation: "compact" })
            .formatToParts(scale)
            .find((part) => part.type === "compact")?.value ?? "");
    return { unit, format: (value) => digits.format(value / scale) };
  }, [stat.decimals, stat.notation, stat.value, locale]);
}

function CountUp({ stat, run, delay, duration, reduced, locale }) {
  const live = useRef(null);
  const done = useRef(false);
  const { unit, format } = useFormat(stat, locale);
  const final = format(stat.value);
  const suffix = `${unit}${stat.suffix ?? ""}`;

  useLayoutEffect(() => {
    if (reduced || done.current || !live.current) return;
    live.current.textContent = format(0);
  }, [format, reduced]);

  useEffect(() => {
    const node = live.current;
    if (!node) return;
    if (reduced) {
      node.textContent = final;
      done.current = true;
      return;
    }
    if (!run || done.current) return;
    const controls = animate(0, stat.value, {
      duration,
      delay,
      ease: enter,
      onUpdate: (latest) => {
        node.textContent = format(latest);
      },
      onComplete: () => {
        node.textContent = final;
        done.current = true;
      },
    });
    return () => controls.stop();
  }, [run, reduced, stat.value, delay, duration, format, final]);

  return (
    <>
      <span className={styles.srOnly}>
        {stat.prefix}
        {final}
        {suffix}
      </span>
      <span className={styles.number} aria-hidden="true">
        {stat.prefix && <span className={styles.prefix}>{stat.prefix}</span>}
        <span className={styles.digits}>
          <span className={styles.sizer}>{final}</span>
          <span ref={live} className={styles.live}>
            {final}
          </span>
        </span>
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </span>
    </>
  );
}

function Trend({ values = [] }) {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => [
    values.length > 1 ? (index / (values.length - 1)) * 100 : 100,
    36 - ((value - min) / span) * 32,
  ]);
  const line = points
    .map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
  const [endX, endY] = points[points.length - 1];

  return (
    <div className={styles.trend}>
      <svg className={styles.draw} viewBox="0 0 100 40" preserveAspectRatio="none">
        <path className={styles.area} d={`${line} L100 40 L0 40 Z`} />
        <path className={styles.line} d={line} vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        className={styles.endDot}
        style={{ left: `${endX}%`, top: `${(endY / 40) * 100}%` }}
      />
    </div>
  );
}

function Uptime({ days = [] }) {
  if (!days.length) return null;
  return (
    <div className={styles.bars} data-dense="">
      {days.map((uptime, index) => (
        <span
          key={index}
          className={styles.bar}
          data-ink={uptime >= 99 ? "" : undefined}
          data-alert={uptime < 95 ? "" : undefined}
          style={{
            "--j": index / days.length,
            "--h": Math.min(1, Math.max(0.3, 1 - (100 - uptime) * 0.05)),
          }}
          title={`Day ${index + 1}: ${uptime}% operational`}
        />
      ))}
    </div>
  );
}

function Distribution({ bins = [], max = 100, marker = 50 }) {
  if (!bins.length) return null;
  const peak = Math.max(...bins) || 1;
  const width = max / bins.length;
  return (
    <div className={styles.bars}>
      {bins.map((count, index) => (
        <span
          key={index}
          className={styles.bar}
          data-ink={index * width <= marker ? "" : undefined}
          style={{
            "--j": index / bins.length,
            "--h": Math.max(0.08, count / peak),
          }}
        />
      ))}
    </div>
  );
}

function Visual({ visual }) {
  if (!visual) return null;
  switch (visual.kind) {
    case "trend":
      return <Trend values={visual.values} />;
    case "uptime":
      return <Uptime days={visual.days} />;
    case "distribution":
      return (
        <Distribution
          bins={visual.bins}
          max={visual.max}
          marker={visual.marker}
        />
      );
    default:
      return null;
  }
}

export const StatsBand = forwardRef(function StatsBand(
  {
    stats = [],
    layout = "plain",
    title,
    description,
    duration = 1.6,
    locale = "en-US",
    className = "",
  },
  ref
) {
  const id = useId();
  const list = useRef(null);
  const inView = useInView(list, { once: true, amount: 0.2 });
  const reduced = useReducedMotionSafe();
  const withVisuals = stats.some((stat) => stat.visual);

  return (
    <section
      ref={ref}
      className={[styles.band, className].filter(Boolean).join(" ")}
      data-layout={layout}
      data-in-view={inView || reduced ? "" : undefined}
      aria-labelledby={title ? `${id}-title` : undefined}
      aria-label={title ? undefined : "Key operational metrics"}
    >
      <div className={styles.inner}>
        {(title || description) && (
          <header className={styles.header}>
            {title && (
              <h2 id={`${id}-title`} className={styles.title}>
                {title}
              </h2>
            )}
            {description && (
              <p className={styles.description}>{description}</p>
            )}
          </header>
        )}
        <dl
          ref={list}
          className={styles.stats}
          data-count={Math.min(stats.length, 4)}
          data-visuals={withVisuals ? "" : undefined}
          style={{
            "--count": Math.min(stats.length, 4),
            "--draw": `${Math.round(duration * 420)}ms`,
          }}
        >
          {stats.map((stat, index) => (
            <div
              key={`${stat.label}-${index}`}
              className={styles.stat}
              style={{ "--i": index }}
              tabIndex={stat.context ? 0 : undefined}
              data-context={stat.context && stat.detail ? "" : undefined}
            >
              <dt className={styles.label}>{stat.label}</dt>
              <dd className={styles.figure}>
                <CountUp
                  stat={stat}
                  run={inView}
                  delay={index * STAGGER}
                  duration={duration}
                  reduced={reduced}
                  locale={locale}
                />
              </dd>
              {(stat.detail || stat.context) && (
                <dd className={styles.caption}>
                  {stat.detail && (
                    <span className={styles.detail}>{stat.detail}</span>
                  )}
                  {stat.context && (
                    <span className={styles.context}>{stat.context}</span>
                  )}
                </dd>
              )}
              {withVisuals && (
                <dd className={styles.visual} aria-hidden="true">
                  {stat.visual && <Visual visual={stat.visual} />}
                </dd>
              )}
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
});

StatsBand.displayName = "StatsBand";
export default StatsBand;
