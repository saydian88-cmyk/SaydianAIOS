export function filteredOverviewTasks<T extends { type?: string; platform?: string; taskNo?: string; title?: string }>(
  tasks: T[],
  filters: { type: string; platform: string; keyword: string },
) {
  const keyword = filters.keyword.toLowerCase();
  return tasks.filter((task) => {
    if (filters.type && task.type !== filters.type) return false;
    if (filters.platform && task.platform !== filters.platform) return false;
    return !keyword || `${task.taskNo || ""} ${task.title || ""}`.toLowerCase().includes(keyword);
  });
}
