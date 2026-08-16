import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { NormalizedReview } from "@/domain/contracts/review";
import { ReviewsTable } from "./reviews-table";
import { getDictionary } from "@/i18n";

const reviews: NormalizedReview[] = [
  {
    reviewId: "review-abc-1",
    sourceReviewId: "r1",
    source: "apple-rss",
    titleOriginal: "",
    bodyOriginal: "Too expensive",
    bodyNormalized: "too expensive",
    rating: 1,
    version: "3.2.1",
    updatedAt: null,
    language: "en",
    rawRef: "raw:r1",
    includedInAnalysis: true,
    dedupeStatus: "unique",
    duplicateOf: null,
  },
  {
    reviewId: "review-abc-2",
    sourceReviewId: "r2",
    source: "apple-rss",
    titleOriginal: "",
    bodyOriginal: "Love the workouts",
    bodyNormalized: "love the workouts",
    rating: 5,
    version: "3.2.1",
    updatedAt: null,
    language: "en",
    rawRef: "raw:r2",
    includedInAnalysis: true,
    dedupeStatus: "identity-conflict",
    duplicateOf: null,
  },
];

describe("ReviewsTable", () => {
  it("filters by rating", () => {
    render(<ReviewsTable reviews={reviews} t={getDictionary("en")} />);
    expect(screen.getByText("Too expensive")).toBeInTheDocument();
    expect(screen.getByText("Love the workouts")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("rating"), { target: { value: "1" } });
    expect(screen.getByText("Too expensive")).toBeInTheDocument();
    expect(screen.queryByText("Love the workouts")).not.toBeInTheDocument();
  });

  it("filters by reviewId and sourceReviewId", () => {
    const dict = getDictionary("en");
    render(<ReviewsTable reviews={reviews} t={dict} />);
    const input = screen.getByPlaceholderText(dict.reviewId);
    fireEvent.change(input, { target: { value: "abc-1" } });
    expect(screen.getByText("Too expensive")).toBeInTheDocument();
    expect(screen.queryByText("Love the workouts")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "r2" } });
    expect(screen.queryByText("Too expensive")).not.toBeInTheDocument();
    expect(screen.getByText("Love the workouts")).toBeInTheDocument();
  });

  it("renders duplicate reviews with identical reviewId without React key errors and allows expanding", () => {
    const duplicateReviews: NormalizedReview[] = [
      {
        reviewId: "c1e9de8bd3dcb6c37505",
        sourceReviewId: "r-dup",
        source: "apple-rss",
        titleOriginal: "Good",
        bodyOriginal: "Great app!",
        bodyNormalized: "great app",
        rating: 5,
        version: "1.0",
        updatedAt: null,
        language: "en",
        rawRef: "raw:r-dup-1",
        includedInAnalysis: true,
        dedupeStatus: "unique",
        duplicateOf: null,
      },
      {
        reviewId: "c1e9de8bd3dcb6c37505",
        sourceReviewId: "r-dup",
        source: "apple-rss",
        titleOriginal: "Good",
        bodyOriginal: "Great app!",
        bodyNormalized: "great app",
        rating: 5,
        version: "1.0",
        updatedAt: null,
        language: "en",
        rawRef: "raw:r-dup-2",
        includedInAnalysis: false,
        dedupeStatus: "duplicate",
        duplicateOf: "c1e9de8bd3dcb6c37505",
      },
    ];

    const dict = getDictionary("en");
    render(<ReviewsTable reviews={duplicateReviews} t={dict} />);

    const cells = screen.getAllByText("Great app!");
    expect(cells).toHaveLength(2);

    // Clicking the first row expands only the first row's detail
    fireEvent.click(cells[0]);
    expect(screen.getByText(/raw:r-dup-1/)).toBeInTheDocument();
    expect(screen.queryByText(/raw:r-dup-2/)).not.toBeInTheDocument();
  });
});
