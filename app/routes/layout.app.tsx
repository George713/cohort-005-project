import { Outlet, useSearchParams } from "react-router";
import { useState } from "react";
import {
  useProtoFeed,
  useVariant,
  announce,
  VARIANTS,
  VariantABell,
  VariantBNavItem,
  VariantBDrawer,
  VariantCNavItem,
  VariantCPage,
  SimulateButton,
} from "~/components/notification-feed.prototype";
import { PrototypeSwitcher } from "~/components/prototype-switcher";
import type { Route } from "./+types/layout.app";
import { Sidebar } from "~/components/sidebar";
import { DevUI } from "~/components/dev-ui";
import { Toaster } from "sonner";
import { getCurrentUserId, getDevCountry } from "~/lib/session";
import { getCountryTierInfo, COUNTRIES } from "~/lib/ppp";
import { eq, and, or, sql, desc } from "drizzle-orm";
import { db } from "~/db";
import {
  users,
  courses,
  modules,
  lessons,
  lessonProgress,
  teams,
  teamMembers,
  TeamMemberRole,
  LessonProgressStatus,
} from "~/db/schema";

function getAllUsers() {
  return db.select().from(users).all();
}

function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

function getTeamForAdmin(userId: number) {
  const membership = db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .get();

  if (!membership) return undefined;

  return db.select().from(teams).where(eq(teams.id, membership.teamId)).get();
}

function isTeamAdmin(userId: number) {
  return !!getTeamForAdmin(userId);
}

function getCourseLessonIds(courseId: number): number[] {
  const courseModules = db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .all();

  if (courseModules.length === 0) return [];

  const courseLessons = db
    .select({ id: lessons.id })
    .from(lessons)
    .where(or(...courseModules.map((m) => eq(lessons.moduleId, m.id)))!)
    .all();

  return courseLessons.map((l) => l.id);
}

function calculateProgress(
  userId: number,
  courseId: number,
  weightByDuration: boolean
) {
  const lessonIds = getCourseLessonIds(courseId);

  if (lessonIds.length === 0) return 0;

  if (weightByDuration) {
    const courseLessons = db
      .select({
        id: lessons.id,
        durationMinutes: lessons.durationMinutes,
      })
      .from(lessons)
      .where(or(...lessonIds.map((id) => eq(lessons.id, id)))!)
      .all();

    const totalDuration = courseLessons.reduce(
      (sum, l) => sum + (l.durationMinutes ?? 1),
      0
    );

    if (totalDuration === 0) return 0;

    const completed = db
      .select()
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.status, LessonProgressStatus.Completed),
          or(...lessonIds.map((id) => eq(lessonProgress.lessonId, id)))!
        )
      )
      .all();

    const completedIds = new Set(completed.map((p) => p.lessonId));

    const completedDuration = courseLessons
      .filter((l) => completedIds.has(l.id))
      .reduce((sum, l) => sum + (l.durationMinutes ?? 1), 0);

    return Math.round((completedDuration / totalDuration) * 100);
  }

  const completedCount = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        or(...lessonIds.map((id) => eq(lessonProgress.lessonId, id)))!
      )
    )
    .get();

  return Math.round(((completedCount?.count ?? 0) / lessonIds.length) * 100);
}

function getCompletedLessonCount(userId: number, courseId: number) {
  const lessonIds = getCourseLessonIds(courseId);
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        or(...lessonIds.map((id) => eq(lessonProgress.lessonId, id)))!
      )
    )
    .get();

  return result?.count ?? 0;
}

function getTotalLessonCount(courseId: number) {
  return getCourseLessonIds(courseId).length;
}

function getRecentlyProgressedCourses(userId: number, limit: number = 3) {
  return db
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      coverImageUrl: courses.coverImageUrl,
      lastActivityId: sql<number>`max(${lessonProgress.id})`,
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessonProgress.userId, userId))
    .groupBy(courses.id)
    .orderBy(desc(sql`max(${lessonProgress.id})`))
    .limit(limit)
    .all();
}

export async function loader({ request }: Route.LoaderArgs) {
  const users = getAllUsers();
  const currentUserId = await getCurrentUserId(request);
  const currentUser = currentUserId ? getUserById(currentUserId) : null;
  const devCountry = await getDevCountry(request);
  const countryTierInfo = getCountryTierInfo(devCountry);

  const recentCourses = currentUserId
    ? getRecentlyProgressedCourses(currentUserId).map((course) => {
        const completedLessons = getCompletedLessonCount(
          currentUserId,
          course.courseId
        );
        const totalLessons = getTotalLessonCount(course.courseId);
        const progress = calculateProgress(currentUserId, course.courseId, false);
        return {
          courseId: course.courseId,
          title: course.courseTitle,
          slug: course.courseSlug,
          coverImageUrl: course.coverImageUrl,
          completedLessons,
          totalLessons,
          progress,
        };
      })
    : [];

  return {
    users: users.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    currentUser: currentUser
      ? {
          id: currentUser.id,
          name: currentUser.name,
          role: currentUser.role,
          avatarUrl: currentUser.avatarUrl ?? null,
        }
      : null,
    recentCourses,
    devCountry,
    countryTierInfo,
    countries: COUNTRIES,
    isTeamAdmin: currentUserId ? isTeamAdmin(currentUserId) : false,
    protoLessonHref: getProtoLessonHref(),
  };
}

// PROTOTYPE: any real lesson, so example Discussion Notifications open a real page.
function getProtoLessonHref() {
  const row = db
    .select({ slug: courses.slug, lessonId: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .limit(1)
    .get();
  return row ? `/courses/${row.slug}/lessons/${row.lessonId}` : "/courses";
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const {
    users,
    currentUser,
    recentCourses,
    devCountry,
    countryTierInfo,
    countries,
    isTeamAdmin: userIsTeamAdmin,
    protoLessonHref,
  } = loaderData;

  const sidebarProps = {
    currentUser,
    recentCourses,
    isTeamAdmin: userIsTeamAdmin,
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {currentUser ? (
        <NotificationPrototype
          key={currentUser.id}
          viewer={{ role: currentUser.role, isTeamAdmin: userIsTeamAdmin }}
          lessonHref={protoLessonHref}
          sidebarProps={sidebarProps}
        />
      ) : (
        <>
          <Sidebar {...sidebarProps} />
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </>
      )}
      <DevUI
        users={users}
        currentUser={currentUser}
        devCountry={devCountry}
        countryTierInfo={countryTierInfo}
        countries={countries}
      />
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}

// PROTOTYPE: mounts the Notification Feed variants around the real sidebar and page.
function NotificationPrototype({
  viewer,
  lessonHref,
  sidebarProps,
}: {
  viewer: Parameters<typeof useProtoFeed>[0];
  lessonHref: string;
  sidebarProps: React.ComponentProps<typeof Sidebar>;
}) {
  const feed = useProtoFeed(viewer, lessonHref);
  const variant = useVariant();
  const [sp] = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [liveIds, setLiveIds] = useState(() => new Set<number>());

  function simulate() {
    const n = feed.simulate();
    setLiveIds((s) => new Set(s).add(n.id));
    announce(variant, n);
  }

  return (
    <>
      <Sidebar
        {...sidebarProps}
        headerSlot={variant === "A" ? <VariantABell feed={feed} /> : undefined}
        navTopSlot={
          variant === "B" ? (
            <VariantBNavItem feed={feed} onOpen={() => setDrawerOpen(true)} />
          ) : variant === "C" ? (
            <VariantCNavItem feed={feed} />
          ) : undefined
        }
      />
      <main className="flex-1 overflow-y-auto">
        {variant === "C" && sp.get("feed") === "1" ? (
          <VariantCPage feed={feed} liveIds={liveIds} />
        ) : (
          <Outlet />
        )}
      </main>
      {variant === "B" && (
        <VariantBDrawer
          feed={feed}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
      )}
      <PrototypeSwitcher
        variants={VARIANTS}
        extra={<SimulateButton onClick={simulate} />}
      />
    </>
  );
}
