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
import { ArrowUpDown } from "lucide-react";
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
    <div className={cn("bg-card rounded-xl border card-shadow flex flex-col", containerClassName)}>
      {/* 🔍 Header */}
      {searchKey && (
        <div className="p-4 border-b flex items-center shrink-0">
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-72"
          />
        </div>
      )}

      {/* 📋 Table */}
      <div
        ref={viewportRef}
        onScroll={onViewportScroll}
        className={cn("min-h-0 flex-1 overflow-auto max-h-[60vh]", viewportClassName)}
      >
        <Table className={tableClassName || "w-full min-w-[600px] border-collapse"}>
          <TableHeader className="sticky top-0 z-30 bg-card">
            {renderHeader ? (
              renderHeader(columns, selectable)
            ) : (
              <TableRow className="bg-muted/40">
                {selectable && (
                  <TableHead className="w-10">
                    <Checkbox />
                  </TableHead>
                )}

                {columns.map((col, columnIndex) => (
                  <TableHead
                    key={String(col.accessor)}
                    className={`text-muted-foreground font-medium bg-muted/40 ${
                      col.sortable ? "cursor-pointer" : ""
                    } ${getStickyLeftClass(columnIndex)} ${col.className || ""}`}
                    onClick={() =>
                      col.sortable && handleSort(col.accessor)
                    }
                  >
                    <div className="flex items-center gap-1">
                      {col.header}
                      {col.sortable && (
                        <ArrowUpDown className="w-4 h-4 opacity-60" />
                      )}
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
                  className="text-center py-10 text-muted-foreground"
                >
                  No data found
                </TableCell>
              </TableRow>
            )}

            {displayedData.map((row) =>
              renderRow ? (
                <TableRow
                  key={String(row[rowKey])}
                  className="hover:bg-muted/40 transition"
                >
                  {renderRow(row)}
                </TableRow>
              ) : (
                <TableRow
                  key={String(row[rowKey])}
                  className="hover:bg-muted/40 transition"
                >
                  {selectable && (
                    <TableCell>
                      <Checkbox />
                    </TableCell>
                  )}

                  {columns.map((col, columnIndex) => (
                    <TableCell
                      key={String(col.accessor)}
                      className={`py-4 bg-card ${getStickyLeftClass(columnIndex)} ${col.className || ""}`}
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
        <div className="sticky bottom-0 z-10 px-4 py-3 text-sm text-muted-foreground border-t bg-card shrink-0">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span>
                Showing {startIndex}-{endIndex} of {totalItems}
              </span>
              <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                <SelectTrigger className="h-8 w-[120px]">
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
