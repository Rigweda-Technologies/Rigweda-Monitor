import React from "react";
import { Bar, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from "chart.js";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend
);

const PerformanceDashboard = () => {
  const summaryCards = [
    { title: "Total Reviews", value: 124, color: "text-blue-600" },
    { title: "Pending Self Reviews", value: 18, color: "text-orange-500" },
    { title: "Pending Manager Reviews", value: 9, color: "text-red-500" },
    { title: "Avg Performance Score", value: "4.2 / 5", color: "text-green-600" },
  ];

  const barData = {
    labels: ["HR", "IT", "Finance", "Sales", "Marketing"],
    datasets: [
      {
        label: "Average Rating",
        data: [4.1, 4.5, 3.9, 4.3, 4.0],
        backgroundColor: "#0F5BD3",
        borderRadius: 6,
      },
    ],
  };

  const lineData = {
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    datasets: [
      {
        label: "Performance Trend",
        data: [3.8, 4.0, 4.1, 4.2, 4.3, 4.2],
        borderColor: "#0F5BD3",
        backgroundColor: "rgba(15,91,211,0.1)",
        tension: 0.4,
        fill: true,
      },
    ],
  };

  return (
    <MainLayout
      title="Performance Dashboard"
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "Performance" },
      ]}
    >
      {/* Header Action */}
      <div className="flex justify-end mb-6">
        <Button className="bg-[#0F5BD3] hover:bg-blue-700">
          + Create Review Cycle
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {summaryCards.map((card, index) => (
          <div
            key={index}
            className="bg-white rounded-xl shadow-sm p-6"
          >
            <p className="text-gray-500 text-sm mb-2">{card.title}</p>
            <p className={`text-3xl font-bold ${card.color}`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-4">
            Department Ratings
          </h2>
          <Bar
            data={barData}
            options={{ responsive: true, maintainAspectRatio: false }}
            height={300}
          />
        </div>

        {/* Line Chart */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-4">
            Performance Trend
          </h2>
          <Line
            data={lineData}
            options={{ responsive: true, maintainAspectRatio: false }}
            height={300}
          />
        </div>
      </div>
    </MainLayout>
  );
};

export default PerformanceDashboard;
