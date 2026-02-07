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
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ManuscriptSelector } from "../manuscript-selector";

// ============================================================
// Mocks (vi.hoisted ensures correct hoisting)
// ============================================================

const { mockToast, mockOnDrop } = vi.hoisted(() => ({
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  // Store the onDrop callback so we can invoke it from tests
  mockOnDrop: { current: null as ((files: File[]) => void) | null },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

// Mock react-dropzone: capture the onDrop callback and expose a testable dropzone
vi.mock("react-dropzone", () => ({
  useDropzone: (config: any) => {
    // Store the onDrop so tests can trigger it directly
    mockOnDrop.current = config.onDrop;
    return {
      getRootProps: () => ({
        "data-testid": "dropzone",
        role: "presentation",
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

/** Simulate dropping a file into the dropzone by calling the captured onDrop */
function simulateFileDrop(file?: File) {
  const f = file || createMockFile();
  if (mockOnDrop.current) {
    mockOnDrop.current([f]);
  } else {
    throw new Error("onDrop not captured - is the dropzone rendered?");
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetchResponses(
  responses: Record<string, { ok: boolean; data: any; status?: number }>
) {
  fetchMock = vi.fn((url: string) => {
    const urlStr = typeof url === "string" ? url : String(url);
    for (const [pattern, resp] of Object.entries(responses)) {
      if (urlStr.includes(pattern)) {
        return Promise.resolve({
          ok: resp.ok,
          status: resp.status || (resp.ok ? 200 : 400),
          json: () => Promise.resolve(resp.data),
        });
      }
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
  });
  global.fetch = fetchMock as any;
}

/** Open the dialog and switch to the Upload New tab */
async function openUploadTab() {
  // Click the trigger button to open the dialog
  const trigger = screen.getByRole("button", { name: /select a manuscript/i });
  await act(async () => {
    fireEvent.click(trigger);
  });

  // Wait for dialog to appear
  await waitFor(() => {
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // Click "Upload New" tab
  const tabs = screen.getAllByRole("tab");
  const uploadTab = tabs.find((t) => t.textContent?.includes("Upload New"));
  expect(uploadTab).toBeDefined();

  await act(async () => {
    fireEvent.click(uploadTab!);
  });

  // Wait for the upload tab panel to become active
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

    // Default fetch mocks
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
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------------
  // Dialog Open/Close
  // ----------------------------------------------------------

  describe("Dialog opening", () => {
    it("renders trigger button with placeholder text", () => {
      render(<ManuscriptSelector {...defaultProps} />);

      const button = screen.getByRole("button", {
        name: /select a manuscript/i,
      });
      expect(button).toBeInTheDocument();
    });

    it("opens dialog when trigger button is clicked", async () => {
      render(<ManuscriptSelector {...defaultProps} />);

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /select a manuscript/i })
        );
      });

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(
          screen.getByText("Select or Upload Manuscript")
        ).toBeInTheDocument();
      });
    });

    it("shows both tabs in dialog", async () => {
      render(<ManuscriptSelector {...defaultProps} />);

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /select a manuscript/i })
        );
      });

      await waitFor(() => {
        const tabs = screen.getAllByRole("tab");
        const tabTexts = tabs.map((t) => t.textContent);
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
      render(<ManuscriptSelector {...defaultProps} />);

      await openUploadTab();

      expect(screen.getByTestId("dropzone")).toBeInTheDocument();
    });

    it("shows format info in the dropzone", async () => {
      render(<ManuscriptSelector {...defaultProps} />);

      await openUploadTab();

      expect(
        screen.getByText(/supported formats: pdf, docx/i)
      ).toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // Upload Flow: clicking Upload New, loading manuscript
  // ----------------------------------------------------------

  describe("Upload flow - manuscript loaded in system", () => {
    it("uploads file and sends correct request to API", async () => {
      mockFetchResponses({
        "/api/manuscripts?status=READY": {
          ok: true,
          data: { manuscripts: [] },
        },
        "/api/publishers": {
          ok: true,
          data: { publishers: [{ id: "pub-123" }] },
        },
        "/api/manuscripts/upload": {
          ok: true,
          data: {
            success: true,
            manuscriptId: "ms-new-123",
            fileName: "test-manuscript.pdf",
            fileSize: 1024,
            status: "EXTRACTING",
            message: "File uploaded successfully. Processing started.",
          },
        },
        "/api/manuscripts/ms-new-123/status": {
          ok: true,
          data: {
            id: "ms-new-123",
            status: "READY",
            progress: 100,
            stage: "Complete",
            title: "A Study on Test Manuscripts",
            isComplete: true,
            hasError: false,
          },
        },
      });

      render(<ManuscriptSelector {...defaultProps} />);
      await openUploadTab();

      // Drop a file
      await act(async () => {
        simulateFileDrop();
      });

      // Verify upload API call
      await waitFor(() => {
        const uploadCall = fetchMock.mock.calls.find(
          (call: any[]) =>
            typeof call[0] === "string" &&
            call[0].includes("/api/manuscripts/upload")
        );
        expect(uploadCall).toBeDefined();

        const options = uploadCall![1];
        expect(options.method).toBe("POST");
        expect(options.body).toBeInstanceOf(FormData);
      });
    });

    it("sends publisherId in upload FormData", async () => {
      mockFetchResponses({
        "/api/manuscripts?status=READY": {
          ok: true,
          data: { manuscripts: [] },
        },
        "/api/publishers": {
          ok: true,
          data: { publishers: [{ id: "pub-123" }] },
        },
        "/api/manuscripts/upload": {
          ok: true,
          data: {
            success: true,
            manuscriptId: "ms-fd-test",
            status: "EXTRACTING",
          },
        },
        "/api/manuscripts/ms-fd-test/status": {
          ok: true,
          data: {
            id: "ms-fd-test",
            status: "EXTRACTING",
            progress: 50,
            stage: "Extracting...",
            isComplete: false,
            hasError: false,
          },
        },
      });

      render(
        <ManuscriptSelector {...defaultProps} publisherId="pub-xyz" />
      );
      await openUploadTab();

      await act(async () => {
        simulateFileDrop();
      });

      await waitFor(() => {
        const uploadCall = fetchMock.mock.calls.find(
          (call: any[]) =>
            typeof call[0] === "string" &&
            call[0].includes("/api/manuscripts/upload")
        );
        expect(uploadCall).toBeDefined();
        const formData = uploadCall![1].body as FormData;
        expect(formData.get("publisherId")).toBe("pub-xyz");
        expect(formData.get("file")).toBeTruthy();
      });
    });

    it("polls status and calls onChange when manuscript processing completes", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const onChangeMock = vi.fn();
      let statusPollCount = 0;

      global.fetch = vi.fn((url: string, options?: any) => {
        const u = typeof url === "string" ? url : String(url);

        if (u.includes("/api/manuscripts?status=READY")) {
          return Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({ manuscripts: [] }),
          });
        }
        if (u.includes("/api/publishers")) {
          return Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({ publishers: [{ id: "pub-123" }] }),
          });
        }
        if (u.includes("/api/manuscripts/upload")) {
          return Promise.resolve({
            ok: true, status: 200,
            json: () =>
              Promise.resolve({
                success: true,
                manuscriptId: "ms-poll",
                status: "EXTRACTING",
              }),
          });
        }
        if (u.includes("/api/manuscripts/ms-poll/status")) {
          statusPollCount++;
          if (statusPollCount <= 1) {
            // First poll: still processing
            return Promise.resolve({
              ok: true, status: 200,
              json: () =>
                Promise.resolve({
                  id: "ms-poll",
                  status: "EXTRACTING",
                  progress: 50,
                  stage: "Extracting text...",
                  isComplete: false,
                  hasError: false,
                }),
            });
          }
          // Second poll: done
          return Promise.resolve({
            ok: true, status: 200,
            json: () =>
              Promise.resolve({
                id: "ms-poll",
                status: "READY",
                progress: 100,
                stage: "Complete",
                title: "Completed Manuscript",
                isComplete: true,
                hasError: false,
              }),
          });
        }
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({}),
        });
      }) as any;

      render(
        <ManuscriptSelector onChange={onChangeMock} publisherId="pub-123" />
      );
      await openUploadTab();

      // Drop file
      await act(async () => {
        simulateFileDrop();
      });

      // Advance timers to trigger poll interval (2000ms)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });

      // After first poll returns incomplete, another poll fires after 2s
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });

      await waitFor(() => {
        expect(statusPollCount).toBeGreaterThanOrEqual(2);
      });

      // onChange should be called with the completed manuscript
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

      vi.useRealTimers();
    });
  });

  // ----------------------------------------------------------
  // Error Handling
  // ----------------------------------------------------------

  describe("Upload error handling", () => {
    it("shows error toast when upload API returns error", async () => {
      mockFetchResponses({
        "/api/manuscripts?status=READY": {
          ok: true,
          data: { manuscripts: [] },
        },
        "/api/publishers": {
          ok: true,
          data: { publishers: [{ id: "pub-123" }] },
        },
        "/api/manuscripts/upload": {
          ok: false,
          status: 400,
          data: { error: "File too large. Maximum size is 50MB" },
        },
      });

      render(<ManuscriptSelector {...defaultProps} />);
      await openUploadTab();

      await act(async () => {
        simulateFileDrop(createMockFile("big.pdf", 60 * 1024 * 1024));
      });

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith(
          "File too large. Maximum size is 50MB"
        );
      });
    });

    it("shows error toast when no publisherId is available", async () => {
      // Fetch publishers returns empty so no auto-resolved publisherId
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

      render(
        <ManuscriptSelector
          onChange={vi.fn()}
          publisherId={undefined}
          allowUpload={true}
        />
      );
      await openUploadTab();

      await act(async () => {
        simulateFileDrop();
      });

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith(
          "Upload not available - publisher ID required"
        );
      });
    });
  });

  // ----------------------------------------------------------
  // Select Existing Tab
  // ----------------------------------------------------------

  describe("Select existing manuscript", () => {
    it("shows list of existing manuscripts in dialog", async () => {
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

      render(<ManuscriptSelector {...defaultProps} />);

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /select a manuscript/i })
        );
      });

      await waitFor(() => {
        expect(screen.getByText("First Manuscript")).toBeInTheDocument();
        expect(screen.getByText("Second Manuscript")).toBeInTheDocument();
      });
    });

    it("shows empty state when no manuscripts exist", async () => {
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

      render(<ManuscriptSelector {...defaultProps} />);

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /select a manuscript/i })
        );
      });

      await waitFor(() => {
        expect(
          screen.getByText("No manuscripts available")
        ).toBeInTheDocument();
      });
    });
  });
});
