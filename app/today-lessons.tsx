"use client";

import { useEffect, useState } from "react";
import { localNow } from "@/lib/calc.ts";
import { gateChips, lastLessonLine, type LearnerListSummary } from "@/lib/learner-card.ts";
import { learnerLicenceReminder } from "@/lib/rules.ts";
import { previousLessonFor, type CalendarLesson } from "@/lib/today-calendar.ts";
import type { Learner, Lesson } from "@/lib/types.ts";

type Schedule = { state: "connected"; date: string; lessons: CalendarLesson[]; incomplete: boolean; refreshedAt: string }
  | { state: "disconnected" | "unavailable" };
type Props = { learners: Learner[]; summaries: Record<string, LearnerListSummary>; onOpenLearner: (id: string) => void };

function directions(address: string, origin?: string | null) {
  const params = new URLSearchParams({ api: "1", destination: address, travelmode: "driving" });
  if (origin) params.set("origin", origin);
  return `https://www.google.com/maps/dir/?${params}`;
}

function LearnerPrep({ learner, summary, onOpen }: { learner: Learner; summary?: LearnerListSummary; onOpen: () => void }) {
  const [last, setLast] = useState<Pick<Lesson, "comments" | "taught" | "competenciesAssessed" | "lessonDate"> | null>();
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/learners/${encodeURIComponent(learner.id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Learner details unavailable");
        const { lessons } = await response.json() as { lessons: Lesson[] };
        const current = lessons.filter((lesson) => lesson.lessonNo > 0)
          .sort((a, b) => b.lessonDate.localeCompare(a.lessonDate) || b.lessonNo - a.lessonNo)[0];
        if (!controller.signal.aborted) setLast(current ?? null);
      }).catch(() => { if (!controller.signal.aborted) setLast(null); });
    return () => controller.abort();
  }, [learner.id]);

  const reminder = learnerLicenceReminder(learner, localNow().date);
  const nextReview = summary ? gateChips(summary).find((gate) => gate.state === "next") : null;
  return (
    <>
      {summary ? <p>{summary.achievedCount}/22 achieved · {lastLessonLine(summary)}</p> : null}
      {nextReview ? <p>Ready to assess {nextReview.label}</p> : null}
      {reminder ? <p className="warn">{reminder.text}</p> : null}
      {last?.taught ? <p>Last taught: {last.taught}</p> : null}
      {last?.competenciesAssessed ? <p>Last assessed: {last.competenciesAssessed}</p> : null}
      {last?.comments ? <p className="today-last-note">{last.comments}</p> : null}
      <button type="button" className="btn ghost small" onClick={onOpen}>Open learner record</button>
    </>
  );
}

export default function TodayLessons({ learners, summaries, onOpenLearner }: Props) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [version, setVersion] = useState(0);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/today-lessons", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json() as Promise<Schedule>)
      .then((data) => { if (!controller.signal.aborted) setSchedule(data); })
      .catch(() => { if (!controller.signal.aborted) setSchedule({ state: "unavailable" }); });
    return () => controller.abort();
  }, [version]);

  return (
    <section className="card today-lessons" aria-labelledby="today-title" data-testid="today-lessons">
      <div className="card-head">
        <h2 id="today-title">Today’s lessons</h2>
        <button type="button" className="btn ghost small" disabled={!schedule} onClick={() => {
          setSchedule(null);
          setVersion((value) => value + 1);
        }}>Refresh</button>
      </div>
      {!schedule ? <p role="status">Loading Google Calendar…</p> : null}
      {schedule?.state === "disconnected" ? <p role="status">Google Calendar connection is not set up for this instructor.</p> : null}
      {schedule?.state === "unavailable" ? <p role="status">Google Calendar is unavailable. Try Refresh.</p> : null}
      {schedule?.state === "connected" ? (
        <>
          {schedule.incomplete ? <p role="status">Some calendar events could not be included. Check Google Calendar for the full schedule.</p> : null}
          {!schedule.incomplete && !schedule.lessons.length ? <p>No driving lessons found in today’s calendar.</p> : null}
          <ol className="today-list">
            {schedule.lessons.map((lesson, index) => {
              const previous = previousLessonFor(schedule.lessons, index);
              const minutes = previous ? Math.floor((Date.parse(lesson.startsAt) - Date.parse(previous.endsAt)) / 60_000) : null;
              const showGap = !schedule.incomplete && minutes !== null && minutes >= 0;
              const learner = learners.find(({ id }) => id === chosen[lesson.id]);
              return (
                <li key={lesson.id} className="today-lesson" data-testid="today-lesson">
                  <p className="today-time">
                    {localNow(new Date(lesson.startsAt)).time}–{localNow(new Date(lesson.endsAt)).time}
                    {minutes !== null && (minutes < 0 || showGap) ? <small className={minutes < 0 ? "warn" : undefined}>
                      {minutes < 0 ? `${Math.abs(minutes)} min overlap` : `${minutes} min between bookings`}
                    </small> : null}
                  </p>
                  <h3>{lesson.name || lesson.title}</h3>
                  {lesson.address ? <p>{lesson.address}</p> : <p>Pickup address missing from booking.</p>}
                  <div className="today-links">
                    {lesson.address ? <a className="btn ghost small" href={directions(lesson.address)} target="_blank" rel="noreferrer">Directions</a> : null}
                    {showGap && lesson.address && previous?.address && previous.address !== lesson.address
                      ? <a className="btn ghost small" href={directions(lesson.address, previous.address)} target="_blank" rel="noreferrer">Route from previous lesson</a> : null}
                    {lesson.phone ? <a className="btn ghost small" href={`tel:${lesson.phone}`}>Call {lesson.phone}</a> : null}
                    {lesson.email ? <a className="btn ghost small" href={`mailto:${encodeURIComponent(lesson.email).replace("%40", "@")}`}>Email {lesson.email}</a> : null}
                  </div>
                  <label className="field">
                    <span>Learner progress</span>
                    <select value={learner?.id ?? ""} onChange={(event) => {
                      const id = event.target.value;
                      setChosen((current) => ({ ...current, [lesson.id]: id }));
                    }}>
                      <option value="">Choose the learner</option>
                      {learners.map(({ id, fullName }) => <option key={id} value={id}>{fullName}</option>)}
                    </select>
                  </label>
                  {learner ? <LearnerPrep key={learner.id} learner={learner} summary={summaries[learner.id]} onOpen={() => onOpenLearner(learner.id)} /> : null}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
      <a className="btn ghost small" href="https://toiletmap.gov.au/" target="_blank" rel="noreferrer">Public toilet map</a>
    </section>
  );
}
