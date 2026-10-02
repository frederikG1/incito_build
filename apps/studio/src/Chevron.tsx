/** The small "opens a menu" mark — drawn, so it reads as one at every size. */
export function Chevron() {
  return (
    <svg className="chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2.5 3.75 5 6.25l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
