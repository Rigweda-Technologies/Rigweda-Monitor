import { MainLayout } from "@/components/layout/MainLayout";
import React from "react";

const ReportsPage: React.FC = () => {
  return (
    <MainLayout
      title="Reports"
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "Reports" }
      ]}
    >
      <div className="p-6">
        {/* Page Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold">Reports</h1>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg">
            Export Report
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-6 mb-6">
          <div className="bg-white p-5 rounded-xl shadow-sm border">
            <p className="text-gray-500 text-sm">Total Employees</p>
            <h2 className="text-2xl font-semibold mt-2">120</h2>
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm border">
            <p className="text-gray-500 text-sm">Active Employees</p>
            <h2 className="text-2xl font-semibold mt-2">110</h2>
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm border">
            <p className="text-gray-500 text-sm">On Leave</p>
            <h2 className="text-2xl font-semibold mt-2">5</h2>
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm border">
            <p className="text-gray-500 text-sm">New Joins (This Month)</p>
            <h2 className="text-2xl font-semibold mt-2">8</h2>
          </div>
        </div>

        {/* Report Table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="font-semibold">Employee Attendance Report</h2>
          </div>

          <table className="w-full text-left">
            <thead className="bg-gray-50 text-gray-600 text-sm">
              <tr>
                <th className="p-4">Employee</th>
                <th className="p-4">Department</th>
                <th className="p-4">Present Days</th>
                <th className="p-4">Absent Days</th>
                <th className="p-4">Late Entries</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t hover:bg-gray-50">
                <td className="p-4">John Doe</td>
                <td className="p-4">HR</td>
                <td className="p-4">20</td>
                <td className="p-4">2</td>
                <td className="p-4">1</td>
                <td className="p-4">
                  <span className="px-3 py-1 bg-green-100 text-green-600 rounded-full text-xs">
                    Good
                  </span>
                </td>
              </tr>

              <tr className="border-t hover:bg-gray-50">
                <td className="p-4">Jane Smith</td>
                <td className="p-4">IT</td>
                <td className="p-4">18</td>
                <td className="p-4">4</td>
                <td className="p-4">3</td>
                <td className="p-4">
                  <span className="px-3 py-1 bg-yellow-100 text-yellow-600 rounded-full text-xs">
                    Average
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </MainLayout>
  );
};

export default ReportsPage;
