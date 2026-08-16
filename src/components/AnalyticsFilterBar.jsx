/**
 * The single filter bar for every Analytics tab.
 *
 * Previously this markup was duplicated across two tabs and absent from a
 * third, so City Health silently inherited whichever filter had last been set
 * elsewhere with nothing on screen to say so.
 *
 * Department options are derived from the data rather than hardcoded. The page
 * used to offer exactly three, which meant reports belonging to the other ten
 * authorities could not be isolated at all.
 */
export function AnalyticsFilterBar({
  dateFilter,
  onDateFilterChange,
  selectedDept,
  onDeptChange,
  departments,
  canChooseDept,
}) {
  return (
    <div className="bg-white border border-[#1f1e1a]/8 rounded-2xl p-5">
      <div className="flex flex-wrap items-center gap-6 text-left">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider">
            Time Interval
          </label>
          <select
            value={dateFilter}
            onChange={(e) => onDateFilterChange(e.target.value)}
            className="bg-[#f5f1e6] border border-[#1f1e1a]/12 rounded-xl px-4 py-2 text-xs font-semibold text-[#201f1b] outline-none focus:border-[#4a5d3f]/50 transition-colors custom-select min-w-[150px]"
          >
            <option value="all">All Time</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider">
            Department Scope
          </label>
          {canChooseDept ? (
            <select
              value={selectedDept}
              onChange={(e) => onDeptChange(e.target.value)}
              className="bg-[#f5f1e6] border border-[#1f1e1a]/12 rounded-xl px-4 py-2 text-xs font-semibold text-[#201f1b] outline-none focus:border-[#4a5d3f]/50 transition-colors custom-select min-w-[180px]"
            >
              <option value="all">All Departments</option>
              {departments.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label} ({d.count})
                </option>
              ))}
            </select>
          ) : (
            <div className="bg-[#f5f1e6] border border-[#1f1e1a]/8 text-[#4b473d] px-4 py-2 rounded-xl text-xs font-bold min-w-[180px] flex items-center gap-1.5 h-[34px]">
              <span className="w-2 h-2 rounded-full bg-[#8a8477]" />
              {selectedDept === 'all' ? 'All Departments' : selectedDept}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
