import type { ComponentProps, MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { throughCurtain } from "../lib/motion";

/** A link between top-level pages that goes through the curtain transition. */
export function TransitionLink({ to, onClick, ...rest }: ComponentProps<typeof Link>) {
  const navigate = useNavigate();
  return (
    <Link
      to={to}
      {...rest}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        throughCurtain(() => navigate(to));
      }}
    />
  );
}
