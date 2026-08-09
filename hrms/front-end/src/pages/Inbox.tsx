import { MainLayout } from "@/components/layout/MainLayout";
import React, { useState } from "react";

interface Message {
  id: string;
  sender: string;
  role: string;
  subject: string;
  body: string;
  date: string;
  unread: boolean;
  starred: boolean;
  priority: "Low" | "Medium" | "High";
}

const dummyMessages: Message[] = [
  {
    id: "1",
    sender: "HR Manager",
    role: "HR",
    subject: "Leave Request Approval",
    body: "Your leave request has been approved.",
    date: "2026-02-06",
    unread: true,
    starred: false,
    priority: "High",
  },
  {
    id: "2",
    sender: "Team Lead",
    role: "Manager",
    subject: "Interview Schedule",
    body: "Interview scheduled for tomorrow at 10 AM.",
    date: "2026-02-05",
    unread: false,
    starred: true,
    priority: "Medium",
  },
];

const Inbox: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>(dummyMessages);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showCompose, setShowCompose] = useState(false);

  const toggleStar = (id: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === id ? { ...msg, starred: !msg.starred } : msg
      )
    );
  };

  return (
    <MainLayout>
      <div className="flex h-screen bg-gray-100">
        {/* Message List */}
        <div className="w-1/3 bg-white border-r overflow-y-auto">
          <div className="p-4 flex justify-between items-center border-b">
            <h2 className="text-xl font-semibold">Inbox</h2>
            <button
              onClick={() => setShowCompose(true)}
              className="bg-blue-600 text-white px-3 py-1 rounded"
            >
              Compose
            </button>
          </div>

          {messages.map((msg) => (
            <div
              key={msg.id}
              onClick={() => {
                setSelectedMessage(msg);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === msg.id ? { ...m, unread: false } : m
                  )
                );
              }}
              className={`p-4 cursor-pointer border-b hover:bg-gray-50 ${
                msg.unread ? "bg-blue-50" : ""
              }`}
            >
              <div className="flex justify-between">
                <span className="font-medium">{msg.sender}</span>
                <span className="text-sm text-gray-500">{msg.date}</span>
              </div>
              <div className="text-sm text-gray-600">{msg.subject}</div>
              <div className="flex justify-between items-center mt-1">
                <span className="text-xs text-gray-400">{msg.role}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleStar(msg.id);
                  }}
                  className="text-yellow-500"
                >
                  {msg.starred ? "★" : "☆"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Message Detail */}
        <div className="flex-1 p-6">
          {selectedMessage ? (
            <div className="bg-white p-6 rounded shadow">
              <h3 className="text-xl font-semibold mb-2">
                {selectedMessage.subject}
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                From: {selectedMessage.sender} ({selectedMessage.role})
              </p>
              <p className="mb-4">{selectedMessage.body}</p>
              <p className="text-xs text-gray-400">
                Priority: {selectedMessage.priority}
              </p>
              <div className="mt-4 space-x-2">
                <button className="px-3 py-1 bg-blue-500 text-white rounded">
                  Reply
                </button>
                <button className="px-3 py-1 bg-gray-300 rounded">
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="text-gray-500">
              Select a message to view details
            </div>
          )}
        </div>
      </div>

      {/* Compose Modal */}
      {showCompose && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center">
          <div className="bg-white w-1/2 p-6 rounded shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Compose Message</h3>
            <input
              type="text"
              placeholder="To"
              className="w-full border p-2 mb-3 rounded"
            />
            <input
              type="text"
              placeholder="Subject"
              className="w-full border p-2 mb-3 rounded"
            />
            <textarea
              placeholder="Message"
              className="w-full border p-2 mb-3 rounded h-32"
            />
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowCompose(false)}
                className="px-4 py-2 bg-gray-300 rounded"
              >
                Cancel
              </button>
              <button className="px-4 py-2 bg-blue-600 text-white rounded">
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
};

export default Inbox;
