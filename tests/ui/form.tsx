import type { FormHTMLAttributes } from "react";

// The isolated Vite harness has no Next router. Browser navigation itself is
// verified against a production Next server, rather than simulated here.
export default function Form({ prefetch, ...props }: FormHTMLAttributes<HTMLFormElement> & { prefetch?: boolean }) {
  void prefetch;
  return <form {...props} />;
}
