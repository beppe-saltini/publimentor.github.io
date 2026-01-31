/**
 * Prometheus Metrics System
 * 
 * Provides metrics collection for:
 * - HTTP request latency and counts
 * - Database query performance
 * - Business metrics (manuscripts, reviews)
 * - System health (memory, uptime)
 */

// ============================================================
// Types
// ============================================================

interface MetricLabels {
  [key: string]: string;
}

interface CounterMetric {
  name: string;
  help: string;
  labels: MetricLabels;
  value: number;
}

interface GaugeMetric {
  name: string;
  help: string;
  labels: MetricLabels;
  value: number;
}

interface HistogramMetric {
  name: string;
  help: string;
  labels: MetricLabels;
  buckets: number[];
  values: number[];
  sum: number;
  count: number;
}

// ============================================================
// Histogram Buckets
// ============================================================

const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const DB_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1];
const EXTERNAL_BUCKETS = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

// ============================================================
// Metrics Registry
// ============================================================

class MetricsRegistry {
  private counters: Map<string, CounterMetric> = new Map();
  private gauges: Map<string, GaugeMetric> = new Map();
  private histograms: Map<string, HistogramMetric> = new Map();

  // ============================================================
  // Counter Methods
  // ============================================================

  incrementCounter(name: string, labels: MetricLabels = {}, help = ""): void {
    const key = this.buildKey(name, labels);
    const existing = this.counters.get(key);

    if (existing) {
      existing.value++;
    } else {
      this.counters.set(key, {
        name,
        help,
        labels,
        value: 1,
      });
    }
  }

  addCounter(name: string, value: number, labels: MetricLabels = {}, help = ""): void {
    const key = this.buildKey(name, labels);
    const existing = this.counters.get(key);

    if (existing) {
      existing.value += value;
    } else {
      this.counters.set(key, {
        name,
        help,
        labels,
        value,
      });
    }
  }

  // ============================================================
  // Gauge Methods
  // ============================================================

  setGauge(name: string, value: number, labels: MetricLabels = {}, help = ""): void {
    const key = this.buildKey(name, labels);
    this.gauges.set(key, {
      name,
      help,
      labels,
      value,
    });
  }

  incrementGauge(name: string, labels: MetricLabels = {}): void {
    const key = this.buildKey(name, labels);
    const existing = this.gauges.get(key);
    if (existing) {
      existing.value++;
    }
  }

  decrementGauge(name: string, labels: MetricLabels = {}): void {
    const key = this.buildKey(name, labels);
    const existing = this.gauges.get(key);
    if (existing) {
      existing.value--;
    }
  }

  // ============================================================
  // Histogram Methods
  // ============================================================

  observeHistogram(
    name: string,
    value: number,
    labels: MetricLabels = {},
    buckets: number[] = HTTP_BUCKETS,
    help = ""
  ): void {
    const key = this.buildKey(name, labels);
    const existing = this.histograms.get(key);

    if (existing) {
      existing.sum += value;
      existing.count++;
      // Update bucket counts
      for (let i = 0; i < existing.buckets.length; i++) {
        if (value <= existing.buckets[i]) {
          existing.values[i]++;
        }
      }
    } else {
      const values = buckets.map((b) => (value <= b ? 1 : 0));
      this.histograms.set(key, {
        name,
        help,
        labels,
        buckets,
        values,
        sum: value,
        count: 1,
      });
    }
  }

  // ============================================================
  // Export Methods
  // ============================================================

  /**
   * Export metrics in Prometheus format
   */
  export(): string {
    const lines: string[] = [];

    // Export counters
    const countersByName = this.groupByName(this.counters);
    for (const [name, metrics] of countersByName) {
      const first = metrics[0];
      lines.push(`# HELP ${name} ${first.help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const metric of metrics) {
        const labelStr = this.formatLabels(metric.labels);
        lines.push(`${name}${labelStr} ${metric.value}`);
      }
    }

    // Export gauges
    const gaugesByName = this.groupByName(this.gauges);
    for (const [name, metrics] of gaugesByName) {
      const first = metrics[0];
      lines.push(`# HELP ${name} ${first.help}`);
      lines.push(`# TYPE ${name} gauge`);
      for (const metric of metrics) {
        const labelStr = this.formatLabels(metric.labels);
        lines.push(`${name}${labelStr} ${metric.value}`);
      }
    }

    // Export histograms
    const histogramsByName = this.groupByName(this.histograms);
    for (const [name, metrics] of histogramsByName) {
      const first = metrics[0];
      lines.push(`# HELP ${name} ${first.help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const metric of metrics) {
        const baseLabels = this.formatLabels(metric.labels);
        // Bucket lines
        for (let i = 0; i < metric.buckets.length; i++) {
          const bucketLabels = metric.labels ? { ...metric.labels, le: String(metric.buckets[i]) } : { le: String(metric.buckets[i]) };
          lines.push(`${name}_bucket${this.formatLabels(bucketLabels)} ${metric.values[i]}`);
        }
        // +Inf bucket
        const infLabels = metric.labels ? { ...metric.labels, le: "+Inf" } : { le: "+Inf" };
        lines.push(`${name}_bucket${this.formatLabels(infLabels)} ${metric.count}`);
        // Sum and count
        lines.push(`${name}_sum${baseLabels} ${metric.sum}`);
        lines.push(`${name}_count${baseLabels} ${metric.count}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Get metrics as JSON
   */
  toJSON(): Record<string, unknown> {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(this.histograms),
    };
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  private buildKey(name: string, labels: MetricLabels): string {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    return `${name}{${labelStr}}`;
  }

  private formatLabels(labels: MetricLabels): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return "";
    return "{" + entries.map(([k, v]) => `${k}="${v}"`).join(",") + "}";
  }

  private groupByName<T extends { name: string }>(
    map: Map<string, T>
  ): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const metric of map.values()) {
      const existing = grouped.get(metric.name) || [];
      existing.push(metric);
      grouped.set(metric.name, existing);
    }
    return grouped;
  }
}

// ============================================================
// Singleton Registry
// ============================================================

export const metricsRegistry = new MetricsRegistry();

// ============================================================
// Pre-defined Metrics
// ============================================================

export const metrics = {
  // HTTP Metrics
  http: {
    requestsTotal: (method: string, route: string, status: string) =>
      metricsRegistry.incrementCounter(
        "http_requests_total",
        { method, route, status },
        "Total number of HTTP requests"
      ),

    requestDuration: (method: string, route: string, durationMs: number) =>
      metricsRegistry.observeHistogram(
        "http_request_duration_seconds",
        durationMs / 1000,
        { method, route },
        HTTP_BUCKETS,
        "HTTP request duration in seconds"
      ),

    activeRequests: {
      increment: () =>
        metricsRegistry.incrementGauge("http_active_requests", {}),
      decrement: () =>
        metricsRegistry.decrementGauge("http_active_requests", {}),
    },
  },

  // Database Metrics
  db: {
    queriesTotal: (operation: string, table: string) =>
      metricsRegistry.incrementCounter(
        "db_queries_total",
        { operation, table },
        "Total number of database queries"
      ),

    queryDuration: (operation: string, table: string, durationMs: number) =>
      metricsRegistry.observeHistogram(
        "db_query_duration_seconds",
        durationMs / 1000,
        { operation, table },
        DB_BUCKETS,
        "Database query duration in seconds"
      ),

    connectionPoolSize: (size: number) =>
      metricsRegistry.setGauge(
        "db_connection_pool_size",
        size,
        {},
        "Database connection pool size"
      ),
  },

  // External API Metrics
  external: {
    requestsTotal: (service: string, operation: string, success: boolean) =>
      metricsRegistry.incrementCounter(
        "external_requests_total",
        { service, operation, success: String(success) },
        "Total number of external API requests"
      ),

    requestDuration: (service: string, operation: string, durationMs: number) =>
      metricsRegistry.observeHistogram(
        "external_request_duration_seconds",
        durationMs / 1000,
        { service, operation },
        EXTERNAL_BUCKETS,
        "External API request duration in seconds"
      ),
  },

  // Business Metrics
  business: {
    manuscriptsUploaded: (publisherId: string) =>
      metricsRegistry.incrementCounter(
        "manuscripts_uploaded_total",
        { publisher_id: publisherId },
        "Total number of manuscripts uploaded"
      ),

    manuscriptsProcessed: (publisherId: string, status: string) =>
      metricsRegistry.incrementCounter(
        "manuscripts_processed_total",
        { publisher_id: publisherId, status },
        "Total number of manuscripts processed"
      ),

    reviewersDiscovered: (count: number) =>
      metricsRegistry.addCounter(
        "reviewers_discovered_total",
        count,
        {},
        "Total number of reviewers discovered"
      ),

    coiChecksPerformed: (hasConflict: boolean) =>
      metricsRegistry.incrementCounter(
        "coi_checks_total",
        { has_conflict: String(hasConflict) },
        "Total number of COI checks performed"
      ),

    activeUsers: (count: number) =>
      metricsRegistry.setGauge(
        "active_users",
        count,
        {},
        "Number of active users"
      ),
  },

  // System Metrics
  system: {
    updateMemory: () => {
      const mem = process.memoryUsage();
      metricsRegistry.setGauge(
        "nodejs_heap_used_bytes",
        mem.heapUsed,
        {},
        "Node.js heap used bytes"
      );
      metricsRegistry.setGauge(
        "nodejs_heap_total_bytes",
        mem.heapTotal,
        {},
        "Node.js heap total bytes"
      );
      metricsRegistry.setGauge(
        "nodejs_external_bytes",
        mem.external,
        {},
        "Node.js external memory bytes"
      );
      metricsRegistry.setGauge(
        "nodejs_rss_bytes",
        mem.rss,
        {},
        "Node.js resident set size bytes"
      );
    },

    uptime: () =>
      metricsRegistry.setGauge(
        "process_uptime_seconds",
        process.uptime(),
        {},
        "Process uptime in seconds"
      ),
  },
};

// ============================================================
// Metrics Endpoint Handler
// ============================================================

export function getMetricsHandler() {
  return async function metricsHandler(): Promise<Response> {
    // Update system metrics
    metrics.system.updateMemory();
    metrics.system.uptime();

    const body = metricsRegistry.export();

    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      },
    });
  };
}
