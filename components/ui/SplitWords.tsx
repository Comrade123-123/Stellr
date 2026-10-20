import { Fragment } from "react";

/** Wraps each word in a mask so `.reveal-word` can rise into view. */
export default function SplitWords({ text }: { text: string }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.split(" ").map((word, i) => (
          <Fragment key={i}>
            <span className="inline-block overflow-hidden pb-[0.12em] align-top">
              <span className="reveal-word inline-block">{word}</span>
            </span>{" "}
          </Fragment>
        ))}
      </span>
    </>
  );
}
