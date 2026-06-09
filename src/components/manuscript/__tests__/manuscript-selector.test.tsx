/**
 * Tests for ManuscriptSelector component
 *
 * Verifies the "Select or Upload Manuscript" dialog:
 * - Dialog opens when trigger button is clicked
 * - "Upload New" tab is accessible and shows dropzone
 * - File upload sends correct request and manuscript is loaded
 * - Processing status polling works
 * - Error states are handled correctly
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ManuscriptSelector } from "../manuscript-selector";

// ============================================================
// Mocks (vi.hoisted ensures correct hoisting for vi.mock)
// ============================================================

const { mockToast, mockOnDrop, mockUploadManuscriptFile } = vi.hoisted(() => ({
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  mockUploadManuscriptFile: vi.fn(),
  // Store the onDrop callback so tests can trigger file drops
  mockOnDrop: { current: null as ((files: File[]) => void) | null },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("@/lib/manuscript/manuscript-upload-flow.client", () => ({
  MAX_MANUSCRIPT_UPLOAD_BYTES: 50 * 1024 * 1024,
  computeFileHash: vi.fn().mockResolvedValue("test-file-hash"),
  checkManuscriptDuplicate: vi.fn().mockResolvedValue({
    isDuplicate: false,
    matches: [],
  }),
  uploadManuscriptFile: mockUploadManuscriptFile,
}));

// Mock react-dropzone: capture the onDrop and expose a testable element
vi.mock("react-dropzone", () => ({
  useDropzone: (config: any) => {
    mockOnDrop.current = config.onDrop;
    return {
      getRootProps: () => ({
        "data-testid": "dropzone",
      }),
      getInputProps: () => ({
        "data-testid": "dropzone-input",
      }),
      isDragActive: false,
    };
  },
}));

// ============================================================
// Helpers
// ============================================================

function createMockFile(
  name = "test-manuscript.pdf",
  size = 1024,
  type = "application/pdf"
): File {
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type });
}

function simulateFileDrop(file?: File) {
  const f = file || createMockFile();
  if (!mockOnDrop.current) {
    throw new Error("onDrop not captured - is the dropzone rendered?");
  }
  mockOnDrop.current([f]);
}

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetchResponses(
  responses: Record<string, { ok: boolean; data: any; status?: number }>
) {
  fetchMock = vi.fn((url: string) => {
    const u = typeof url === "string" ? url : String(url);
    for (const [pattern, resp] of Object.entries(responses)) {
      if (u.includes(pattern)) {
        const body = JSON.stringify(resp.data);
        return Promise.resolve({
          ok: resp.ok,
          status: resp.status || (resp.ok ? 200 : 400),
          json: () => Promise.resolve(resp.data),
          text: () => Promise.resolve(body),
        });
      }
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve("{}"),
    });
  });
  global.fetch = fetchMock as any;
}

/** Open dialog and click Upload New tab using userEvent for proper pointer events */
async function openUploadTab(user: ReturnType<typeof userEvent.setup>) {
  // Click trigger to open dialog
  const trigger = screen.getByRole("button", { name: /select a manuscript/i });
  await user.click(trigger);

  // Wait for dialog
  await waitFor(() => {
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // Find and click the "Upload New" tab
  const tabs = screen.getAllByRole("tab");
  const uploadTab = tabs.find((t) => t.textContent?.includes("Upload New"));
  expect(uploadTab).toBeDefined();
  await user.click(uploadTab!);

  // Wait for dropzone to appear (upload tab content rendered)
  await waitFor(() => {
    expect(screen.getByTestId("dropzone")).toBeInTheDocument();
  });
}

// ============================================================
// Tests
// ============================================================

describe("ManuscriptSelector", () => {
  const defaultProps = {
    onChange: vi.fn(),
    onManuscriptData: vi.fn(),
    publisherId: "pub-123",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnDrop.current = null;
    mockUploadManuscriptFile.mockResolvedValue({ manuscriptId: "ms-new-123" });

    mockFetchResponses({
      "/api/manuscripts?status=READY": {
        ok: true,
        data: { manuscripts: [] },
      },
      "/api/publishers": {
        ok: true,
        data: { publishers: [{ id: "pub-123" }] },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------------
  // Dialog
  // ----------------------------------------------------------

  describe("Dialog opening", () => {
    it("renders trigger button with placeholder text", () => {
      render(<ManuscriptSelector {...defaultProps} />);
      expect(
        screen.getByRole("button", { name: /select a manuscript/i })
      ).toBeInTheDocument();
    });

    it("opens dialog when trigger is clicked", async () => {
      const user = userEvent.setup();
      render(<ManuscriptSelector {...defaultProps} />);

      await user.click(
        screen.getByRole("button", { name: /select a manuscript/i })
      );

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(
          screen.getByText("Select or Upload Manuscript")
        ).toBeInTheDocument();
      });
    });

    it("shows Select Existing and Upload New tabs", async () => {
      const user = userEvent.setup();
      render(<ManuscriptSelector {...defaultProps} />);
      await user.click(
        screen.getByRole("button", { name: /select a manuscript/i })
      );

      await waitFor(() => {
        const tabTexts = screen
          .getAllByRole("tab")
          .map((t) => t.textContent);
        expect(tabTexts).toEqual(
          expect.arrayContaining([
            expect.stringContaining("Select Existing"),
            expect.stringContaining("Upload New"),
          ])
        );
      });
    });
  });

  // ----------------------------------------------------------
  // Upload New Tab
  // ----------------------------------------------------------

  describe("Upload New tab", () => {
    it("shows dropzone when Upload New tab is clicked", async () => {
      const user = userEvent.setup();
      render(<ManuscriptSelector {...defaultProps} />);
      await openUploadTab(user);

      expect(screen.getByTestId("dropzone")).toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // Upload flow: file uploaded -> manuscript loaded in system
  // ----------------------------------------------------------

  describe("Upload flow - manuscript loaded in system", () => {
    it("sends upload request with file and publisherId", async () => {
      const user = userEvent.setup();

      render(
        <ManuscriptSelector {...defaultProps} publisherId="pub-test-99" />
      );
      await openUploadTab(user);

      await act(async () => {
        simulateFileDrop();
      });

      await waitFor(() => {
        expect(mockUploadManuscriptFile).toHaveBeenCalledWith(
          expect.objectContaining({
            publisherId: "pub-test-99",
            file: expect.any(File),
          })
        );
      });
    });

    it("polls status and auto-selects manuscript when ready", async () => {
      const onChangeMock = vi.fn();
      let pollCount = 0;

      // The status endpoint returns "processing" first, then "ready"
      global.fetch = vi.fn((url: string) => {
        const u = typeof url === "string" ? url : String(url);

        const jsonBody = (data: unknown) => {
          const body = JSON.stringify(data);
          return {
            ok: true,
            status: 200,
            json: () => Promise.resolve(data),
            text: () => Promise.resolve(body),
          };
        };

        if (u.includes("/api/manuscripts?status=READY"))
          return Promise.resolve(jsonBody({ manuscripts: [] }));
        if (u.includes("/api/publishers"))
          return Promise.resolve(jsonBody({ publishers: [{ id: "pub-123" }] }));
        if (u.includes("/api/manuscripts/ms-poll/status")) {
          pollCount++;
          const isComplete = pollCount > 1;
          return Promise.resolve(
            jsonBody({
              id: "ms-poll",
              status: isComplete ? "READY" : "EXTRACTING",
              progress: isComplete ? 100 : 50,
              stage: isComplete ? "Complete" : "Extracting text...",
              title: isComplete ? "Finished Manuscript" : undefined,
              isComplete,
              hasError: false,
            })
          );
        }
        return Promise.resolve(jsonBody({}));
      }) as any;

      mockUploadManuscriptFile.mockResolvedValue({ manuscriptId: "ms-poll" });

      // Use real timers for UI interactions, they are fast
      const user = userEvent.setup();
      render(
        <ManuscriptSelector onChange={onChangeMock} publisherId="pub-123" />
      );
      await openUploadTab(user);

      // Drop file - triggers upload + first pollStatus call
      await act(async () => {
        simulateFileDrop();
      });

      // The component uses setTimeout(2000ms) to poll. Wait for it with real timers.
      // Use waitFor with a longer timeout to let the real 2s intervals fire.
      await waitFor(
        () => {
          expect(pollCount).toBeGreaterThanOrEqual(2);
        },
        { timeout: 8000 }
      );

      // Manuscript should be auto-selected via onChange
      await waitFor(() => {
        expect(onChangeMock).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "ms-poll",
            status: "READY",
          })
        );
      });

      expect(mockToast.success).toHaveBeenCalledWith(
        "Manuscript uploaded and processed!"
      );
    }, 15000);
  });

  // ----------------------------------------------------------
  // Error handling
  // ----------------------------------------------------------

  describe("Upload error handling", () => {
    it("shows error toast when file exceeds size limit", async () => {
      const user = userEvent.setup();
      render(<ManuscriptSelector {...defaultProps} />);
      await openUploadTab(user);

      await act(async () => {
        simulateFileDrop(createMockFile("big.pdf", 60 * 1024 * 1024));
      });

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith(
          expect.stringContaining("too large")
        );
      });
    });

    it("shows error toast when no publisherId available", async () => {
      mockFetchResponses({
        "/api/manuscripts?status=READY": {
          ok: true,
          data: { manuscripts: [] },
        },
        "/api/publishers": {
          ok: true,
          data: { publishers: [] },
        },
      });

      const user = userEvent.setup();
      render(
        <ManuscriptSelector
          onChange={vi.fn()}
          publisherId={undefined}
          allowUpload={true}
        />
      );

      // Open dialog
      await user.click(
        screen.getByRole("button", { name: /select a manuscript/i })
      );
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      // Click Upload New tab
      const tabs = screen.getAllByRole("tab");
      const uploadTab = tabs.find((t) =>
        t.textContent?.includes("Upload New")
      );
      expect(uploadTab).toBeDefined();
      await user.click(uploadTab!);

      // Wait for tab to become active (the dropzone may or may not render
      // depending on how react-dropzone hook is called, but the mock
      // captures onDrop on hook invocation regardless)
      await waitFor(() => {
        // Either the dropzone is rendered, or we can try to simulate drop
        expect(mockOnDrop.current).not.toBeNull();
      });

      await act(async () => {
        simulateFileDrop();
      });

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith(
          "Upload not available — publisher ID not loaded. Try refreshing the page."
        );
      });
    });
  });

  // ----------------------------------------------------------
  // Select Existing
  // ----------------------------------------------------------

  describe("Select existing manuscript", () => {
    it("shows list of existing manuscripts", async () => {
      mockFetchResponses({
        "/api/manuscripts?status=READY": {
          ok: true,
          data: {
            manuscripts: [
              {
                id: "ms-1",
                title: "First Manuscript",
                fileName: "first.pdf",
                fileType: "pdf",
                status: "READY",
                authorCount: 3,
                createdAt: "2026-01-15T00:00:00Z",
              },
              {
                id: "ms-2",
                title: "Second Manuscript",
                fileName: "second.pdf",
                fileType: "pdf",
                status: "READY",
                authorCount: 5,
                createdAt: "2026-01-20T00:00:00Z",
              },
            ],
          },
        },
        "/api/publishers": {
          ok: true,
          data: { publishers: [{ id: "pub-123" }] },
        },
      });

      const user = userEvent.setup();
      render(<ManuscriptSelector {...defaultProps} />);

      await user.click(
        screen.getByRole("button", { name: /select a manuscript/i })
      );

      await waitFor(() => {
        expect(screen.getByText("First Manuscript")).toBeInTheDocument();
        expect(screen.getByText("Second Manuscript")).toBeInTheDocument();
      });
    });

    it("shows empty state when no manuscripts exist", async () => {
      const user = userEvent.setup();
      render(<ManuscriptSelector {...defaultProps} />);

      await user.click(
        screen.getByRole("button", { name: /select a manuscript/i })
      );

      await waitFor(() => {
        expect(
          screen.getByText("No manuscripts available")
        ).toBeInTheDocument();
      });
    });
  });
});
