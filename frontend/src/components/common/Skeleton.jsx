import React from "react";

/**
 * A shimmering placeholder bar used for skeleton loading states.
 * Pass `width`/`height` as CSS strings (e.g. "60%", "14px") or use the
 * preset classes (`skeleton-line`, `skeleton-circle`, etc.) defined in index.css.
 */
export function Skeleton({ className = "", width, height, rounded, style }) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius: rounded, ...style }}
      aria-hidden="true"
    />
  );
}

/**
 * A stack of skeleton lines that imitates a few lines of text.
 */
export function SkeletonText({ lines = 3, className = "" }) {
  return (
    <div className={`skeleton-text-stack ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="skeleton-line"
          width={i === lines - 1 ? "60%" : "100%"}
          height="10px"
        />
      ))}
    </div>
  );
}
