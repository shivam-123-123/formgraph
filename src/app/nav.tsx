"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav() {
  const path = usePathname();
  return (
    <aside className="rail">
      <h1>Formgraph</h1>
      <p>Intake, indexed three ways</p>
      <nav>
        <Link href="/" data-active={path === "/"}>
          New submission
        </Link>
        <Link href="/chat" data-active={path === "/chat"}>
          Ask
        </Link>
      </nav>
      <div className="ext">
        <a href="http://localhost:7474" target="_blank" rel="noreferrer">
          Open Neo4j Browser
        </a>
      </div>
    </aside>
  );
}
