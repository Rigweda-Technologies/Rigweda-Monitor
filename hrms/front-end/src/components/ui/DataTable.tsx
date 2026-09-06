import { useEffect, useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { ArrowUpDown, Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import type { RefObject, UIEventHandler } from "react";

export interface Column<T> {
  header: string;
  accessor: keyof T;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  searchKey?: keyof T;
  rowKey: keyof T;
  selectable?: boolean;
  tableClassName?: string;
  renderHeader?: (columns: Column<T>[], selectable: boolean) => React.ReactNode;
  renderRow?: (row: T) => React.ReactNode;
  columnsCountOverride?: number;
  hideFooter?: boolean;
  containerClassName?: string;
  viewportClassName?: string;
  viewportRef?: RefObject<HTMLDivElement | null>;
  onViewportScroll?: UIEventHandler<HTMLDivElement>;
}

export function DataTable<T>({
  columns,
  data,
  searchKey,
  rowKey,
  selectable = false,
  tableClassName,
  renderHeader,
  renderRow,
  columnsCountOverride,
  hideFooter = false,
  containerClassName,
  viewportClassName,
  viewportRef,
  onViewportScroll,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortConfig, setSortConfig] = useState<{
    key: keyof T;
    direction: "asc" | "desc";
  } | null>(null);

  const filteredData = useMemo(() => {
    let filtered = [...data];

    if (search && searchKey) {
      filtered = filtered.filter((item) =>
        String(item[searchKey])
          .toLowerCase()
          .includes(search.toLowerCase())
      );
    }

    if (sortConfig) {
      filtered.sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];
        if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [data, search, sortConfig, searchKey]);

  const handleSort = (key: keyof T) => {
    setSortConfig((prev) => ({
      key,
      direction:
        prev?.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const getStickyLeftClass = (columnIndex: number) => {
    if (columnIndex !== 0) return "";
    return selectable ? "sticky left-10 z-10" : "sticky left-0 z-10";
  };

  const totalItems = filteredData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    setCurrentPage(1);
  }, [search, sortConfig, data.length, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, currentPage, pageSize]);

  const displayedData = hideFooter ? filteredData : paginatedData;

  const startIndex = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endIndex = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className={cn("overflow-hidden rounded-[28px] border border-slate-100 bg-white shadow-sm flex flex-col", containerClassName)}>
      {/* 🔍 Header */}
      {searchKey && (
        <div className="flex shrink-0 items-center border-b border-slate-100 p-4 sm:p-5">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-12 rounded-2xl border-slate-200 bg-slate-50 pl-11 text-slate-700 placeholder:text-slate-400"
            />
          </div>
        </div>
      )}

      {/* 📋 Table */}
      <div
        ref={viewportRef}
        onScroll={onViewportScroll}
        className={cn("min-h-0 flex-1 overflow-auto max-h-[60vh]", viewportClassName)}
      >
        <Table className={tableClassName || "w-full min-w-[600px] border-collapse"}>
          <TableHeader className="sticky top-0 z-30 bg-slate-50/90">
            {renderHeader ? (
              renderHeader(columns, selectable)
            ) : (
              <TableRow className="border-b border-slate-100 bg-slate-50/90 hover:bg-slate-50/90">
                {selectable && (
                  <TableHead className="w-12 bg-slate-50/90 px-5 py-4">
                    <Checkbox />
                  </TableHead>
                )}

                {columns.map((col, columnIndex) => (
                  <TableHead
                    key={String(col.accessor)}
                    className={`h-auto bg-slate-50/90 px-5 py-4 text-sm font-medium text-slate-500 ${
                      col.sortable ? "cursor-pointer" : ""
                    } ${getStickyLeftClass(columnIndex)} ${col.className || ""}`}
                    onClick={() =>
                      col.sortable && handleSort(col.accessor)
                    }
                  >
                    <div className="flex items-center gap-1">
                      {col.header}
                      {col.sortable && <ArrowUpDown className="h-4 w-4 opacity-50" />}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            )}
          </TableHeader>

          <TableBody>
            {totalItems === 0 && (
              <TableRow>
                <TableCell
                  colSpan={
                    columnsCountOverride ??
                    columns.length + (selectable ? 1 : 0)
                  }
                  className="py-12 text-center text-slate-500"
                >
                  No data found
                </TableCell>
              </TableRow>
            )}

            {displayedData.map((row) =>
              renderRow ? (
                <TableRow
                  key={String(row[rowKey])}
                  className="border-b border-slate-100 transition hover:bg-emerald-50/30"
                >
                  {renderRow(row)}
                </TableRow>
              ) : (
                <TableRow
                  key={String(row[rowKey])}
                  className="border-b border-slate-100 transition hover:bg-emerald-50/30"
                >
                  {selectable && (
                    <TableCell className="px-5 py-4">
                      <Checkbox />
                    </TableCell>
                  )}

                  {columns.map((col, columnIndex) => (
                    <TableCell
                      key={String(col.accessor)}
                      className={`bg-white px-5 py-4 text-slate-800 ${getStickyLeftClass(columnIndex)} ${col.className || ""}`}
                    >
                      {col.render
                        ? col.render(row)
                        : String(row[col.accessor])}
                    </TableCell>
                  ))}
                </TableRow>
              )
            )}
          </TableBody>
        </Table>
      </div>

      {/* 📌 Footer */}
      {!hideFooter && (
        <div className="sticky bottom-0 z-10 shrink-0 border-t border-slate-100 bg-white px-4 py-3 text-sm text-slate-500">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span>
                Showing {startIndex}-{endIndex} of {totalItems}
              </span>
              <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                <SelectTrigger className="h-10 w-[128px] rounded-xl border-slate-200 bg-slate-50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 rows</SelectItem>
                  <SelectItem value="25">25 rows</SelectItem>
                  <SelectItem value="50">50 rows</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Pagination className="justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (currentPage > 1) setCurrentPage((p) => p - 1);
                    }}
                    className={currentPage <= 1 ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#" isActive>
                    {currentPage}/{totalPages}
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (currentPage < totalPages) setCurrentPage((p) => p + 1);
                    }}
                    className={currentPage >= totalPages ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </div>
      )}
    </div>
  );
}
