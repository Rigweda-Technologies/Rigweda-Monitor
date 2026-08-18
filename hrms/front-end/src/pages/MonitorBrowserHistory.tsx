import { useCallback, useEffect, useState } from "react";
import { Globe, RefreshCw, ExternalLink } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { getMonitorBrowserHistory, MonitorBrowserHistory } from "@/services/monitorActivity";
import { formatDateTimeInOrgTimeZone, getOrgTimeZone, setOrgTimeZone, subscribeToOrgTimeZone, toDateKeyInOrgTimeZone } from "@/utils/timezone";
import { toast } from "sonner";

const today = () => toDateKeyInOrgTimeZone(new Date());
const INITIAL_LIMIT = 50;

const getBrowserColor = (browser: string): string => {
  const lower = (browser || "").toLowerCase();
  if (lower.includes("chrome")) return "bg-blue-100 text-blue-800";
  if (lower.includes("edge")) return "bg-cyan-100 text-cyan-800";
  if (lower.includes("firefox")) return "bg-orange-100 text-orange-800";
  if (lower.includes("brave")) return "bg-amber-100 text-amber-800";
  return "bg-gray-100 text-gray-800";
};

const formatTime = (value: string | null, timeZone: string) => {
  if (!value) return "-";
  try {
    return formatDateTimeInOrgTimeZone(value, {}, timeZone);
  } catch {
    return value;
  }
};

const formatUrl = (url: string) => {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url.substring(0, 50);
  }
};

const formatDuration = (ms: number | undefined) => {
  if (!ms) return "-";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

const sortBrowserHistoryDesc = (items: MonitorBrowserHistory[]) =>
  [...items].sort((left, right) => {
    const leftTime = new Date(left.timestamp || "").getTime();
    const rightTime = new Date(right.timestamp || "").getTime();
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return String(right.id || "").localeCompare(String(left.id || ""));
  });

const MonitorBrowserHistory = () => {
  const [date, setDate] = useState(today);
  const [histories, setHistories] = useState<MonitorBrowserHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timeZone, setTimeZone] = useState(() => getOrgTimeZone());
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [browserFilter, setBrowserFilter] = useState("");
  const [searchUrl, setSearchUrl] = useState("");

  const loadHistories = useCallback(async (manual = false) => {
    if (manual) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const data = await getMonitorBrowserHistory(date, { limit: INITIAL_LIMIT, offset, browser: browserFilter });
      if (data.timezone) {
        setTimeZone(data.timezone);
        setOrgTimeZone(data.timezone);
      }
      setHistories(sortBrowserHistoryDesc(data.histories || []));
      setTotal(data.total || 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load browser history";
      toast.error(message);
    } finally {
      if (manual) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [date, browserFilter, offset]);

  useEffect(() => {
    loadHistories();
  }, [loadHistories]);

  useEffect(() => {
    const unsubscribe = subscribeToOrgTimeZone((newTimeZone) => {
      setTimeZone(newTimeZone);
    });
    return unsubscribe;
  }, []);

  const filteredHistories = searchUrl
    ? histories.filter((h) => h.url.toLowerCase().includes(searchUrl.toLowerCase()) || h.title?.toLowerCase().includes(searchUrl.toLowerCase()))
    : histories;

  const browserOptions = Array.from(new Set(histories.map((h) => h.browser))).sort();

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Globe className="h-8 w-8 text-blue-600" />
            <h1 className="text-3xl font-bold">Browser History Monitoring</h1>
          </div>
          <Button onClick={() => loadHistories(true)} disabled={refreshing} variant="outline" size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Date Selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Date</label>
                  <Input
                    type="date"
                    value={date}
                  onChange={(e) => {
                    setOffset(0);
                    setDate(e.target.value);
                  }}
                    className="w-full"
                  />
                </div>

              {/* Browser Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Browser</label>
                <select
                  value={browserFilter}
                  onChange={(e) => {
                    setOffset(0);
                    setBrowserFilter(e.target.value);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">All Browsers</option>
                  {browserOptions.map((browser) => (
                    <option key={browser} value={browser}>
                      {browser.replace(/\.exe/i, "").toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              {/* Search URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Search URL/Title</label>
                <Input
                  placeholder="Search URLs or page titles..."
                  value={searchUrl}
                  onChange={(e) => setSearchUrl(e.target.value)}
                  className="w-full"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Total Visits</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{total}</div>
              <p className="text-xs text-gray-500 mt-1">on {date}</p>
              <p className="text-xs text-gray-400 mt-1">Showing in {timeZone}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Displayed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{filteredHistories.length}</div>
              <p className="text-xs text-gray-500 mt-1">with filters applied</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Unique Domains</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{Array.from(new Set(filteredHistories.map((h) => formatUrl(h.url)))).length}</div>
              <p className="text-xs text-gray-500 mt-1">domains visited</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Browsers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{browserOptions.length}</div>
              <p className="text-xs text-gray-500 mt-1">browsers monitored</p>
            </CardContent>
          </Card>
        </div>

        {/* History Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Browser History</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-gray-500">Loading browser history...</div>
              </div>
            ) : filteredHistories.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-gray-500">No browser history found for the selected filters.</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="font-semibold">Timestamp</TableHead>
                      <TableHead className="font-semibold">Browser</TableHead>
                      <TableHead className="font-semibold">URL</TableHead>
                      <TableHead className="font-semibold">Title</TableHead>
                      <TableHead className="font-semibold text-right">Duration</TableHead>
                      <TableHead className="font-semibold text-center">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredHistories.map((history) => (
                      <TableRow key={history.id} className="hover:bg-gray-50">
                        <TableCell className="font-mono text-sm">{formatTime(history.timestamp, timeZone)}</TableCell>
                        <TableCell>
                          <Badge className={getBrowserColor(history.browser)}>
                            {history.browser.replace(/\.exe/i, "").toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          <span className="text-xs text-gray-600" title={history.url}>
                            {formatUrl(history.url)}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-sm truncate text-sm" title={history.title}>
                          {history.title || "-"}
                        </TableCell>
                        <TableCell className="text-right text-sm">{formatDuration(history.duration)}</TableCell>
                        <TableCell className="text-center">
                          <a
                            href={history.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-blue-600 hover:text-blue-800"
                            title="Open URL"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination Info */}
        {total > 0 && (
          <div className="flex items-center justify-between text-sm text-gray-600">
            <div>Showing {offset + 1} to {Math.min(offset + INITIAL_LIMIT, total)} of {total} entries</div>
            {total > INITIAL_LIMIT && (
              <div className="space-x-2">
                <Button
                  onClick={() => {
                    const newOffset = Math.max(0, offset - INITIAL_LIMIT);
                    setOffset(newOffset);
                  }}
                  disabled={offset === 0}
                  variant="outline"
                  size="sm"
                >
                  Previous
                </Button>
                <Button
                  onClick={() => {
                    const newOffset = offset + INITIAL_LIMIT;
                    if (newOffset < total) {
                      setOffset(newOffset);
                    }
                  }}
                  disabled={offset + INITIAL_LIMIT >= total}
                  variant="outline"
                  size="sm"
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </MainLayout>
  );
};

export default MonitorBrowserHistory;
