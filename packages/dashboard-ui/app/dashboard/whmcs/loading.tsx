export default function WhmcsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading WHMCS generator">
      <div className="h-8 w-56 animate-shimmer-mint rounded-md" />
      <div className="h-24 w-full animate-shimmer-mint rounded-xl" />
      <div className="h-72 w-full animate-shimmer-mint rounded-xl" />
    </div>
  )
}
