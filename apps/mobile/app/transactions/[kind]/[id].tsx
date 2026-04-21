import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatCurrency, loadBuyerBooking, loadBuyerOrder, type Booking, type Order } from '@/lib/api';
import {
  clearBuyerRecentTransactionReceipts,
  getBuyerDeliveryRetryMode,
  getBuyerRecentTransactionReceipts,
  setBuyerBrowseFilters,
  setBuyerDeliveryRetryMode,
  setBuyerRecentTransactionReceipts,
} from '@/lib/session-storage';
import { useBuyerSession } from '@/providers/buyer-session';

function formatRetryMode(mode: 'best_effort' | 'atomic') {
  return mode === 'atomic' ? 'Validate First' : 'Best Effort';
}

function toggleRetryMode(mode: 'best_effort' | 'atomic') {
  return mode === 'atomic' ? 'best_effort' : 'atomic';
}

function getPrimaryImageUrl(listing: { images?: { image_url: string }[] | null }) {
  return listing.images?.[0]?.image_url ?? null;
}

function getSuggestionSecondarySignal(listing: {
  duration_minutes?: number | null;
  price_cents?: number | null;
  currency?: string | null;
}) {
  if (listing.duration_minutes) {
    return `${listing.duration_minutes} min`;
  }

  if (typeof listing.price_cents === 'number' && typeof listing.currency === 'string') {
    return formatCurrency(listing.price_cents, listing.currency);
  }

  return 'Price unavailable';
}

function getSuggestionActionMode(listing: {
  requires_booking?: boolean | null;
  type: 'product' | 'service' | 'hybrid';
}) {
  return listing.requires_booking || listing.type === 'service' ? 'Booking ready' : 'Order ready';
}

function getSuggestionSellerLabel(listing: { seller_id: string }, currentSellerId: string | null) {
  if (!currentSellerId) {
    return 'Marketplace seller';
  }

  return listing.seller_id === currentSellerId ? 'Same seller' : 'Another seller';
}

function getSuggestionSellerPriority(listing: { seller_id: string }, currentSellerId: string | null) {
  if (!currentSellerId) {
    return 0;
  }

  return listing.seller_id === currentSellerId ? 1 : 0;
}

function getSuggestionFollowOn(listing: { seller_id: string }, currentSellerId: string | null) {
  return currentSellerId && listing.seller_id === currentSellerId ? 'same-seller' : 'cross-seller';
}

function getRecommendedBrowsePreset(input: {
  listings: {
    id: string;
    type: 'product' | 'service' | 'hybrid';
    is_local_only?: boolean | null;
  }[];
  orders: {
    items?: { listing_id: string }[] | null;
  }[];
  bookings: {
    listing_id: string;
    listing_type?: string | null;
  }[];
}) {
  const productScore = input.orders.reduce((count, order) => {
    const matchingListings = (order.items ?? [])
      .map((item) => input.listings.find((listing) => listing.id === item.listing_id))
      .filter((listing): listing is (typeof input.listings)[number] => Boolean(listing));

    return (
      count +
      matchingListings.filter(
        (listing) => listing.type === 'product' || listing.type === 'hybrid',
      ).length
    );
  }, 0);

  const serviceScore = input.bookings.filter(
    (booking) => booking.listing_type === 'service' || booking.listing_type === 'hybrid',
  ).length;

  const localScore =
    input.orders.reduce((count, order) => {
      const hasLocalMatch = (order.items ?? []).some((item) =>
        input.listings.some(
          (itemListing) => itemListing.id === item.listing_id && itemListing.is_local_only,
        ),
      );
      return count + (hasLocalMatch ? 1 : 0);
    }, 0) +
    input.bookings.filter((booking) =>
      input.listings.some(
        (itemListing) => itemListing.id === booking.listing_id && itemListing.is_local_only,
      ),
    ).length;

  const hybridScore =
    input.orders.reduce((count, order) => {
      const hasHybridMatch = (order.items ?? []).some((item) =>
        input.listings.some(
          (itemListing) => itemListing.id === item.listing_id && itemListing.type === 'hybrid',
        ),
      );
      return count + (hasHybridMatch ? 1 : 0);
    }, 0) +
    input.bookings.filter((booking) => booking.listing_type === 'hybrid').length;

  if (localScore >= Math.max(productScore, serviceScore, hybridScore) && localScore > 0) {
    return { label: 'Local-First' as const };
  }

  if (serviceScore >= Math.max(productScore, hybridScore) && serviceScore > 0) {
    return { label: 'Services' as const };
  }

  if (hybridScore >= Math.max(productScore, serviceScore) && hybridScore > 0) {
    return { label: 'Hybrid' as const };
  }

  if (productScore > 0) {
    return { label: 'Products' as const };
  }

  return null;
}

function getRecommendationScore(
  listing: {
    type: 'product' | 'service' | 'hybrid';
    is_local_only?: boolean | null;
  },
  preset: { label: 'Local-First' | 'Services' | 'Hybrid' | 'Products' } | null,
) {
  if (!preset) {
    return 0;
  }

  if (preset.label === 'Local-First' && listing.is_local_only) {
    return 3;
  }

  if (
    preset.label === 'Services' &&
    (listing.type === 'service' || listing.type === 'hybrid')
  ) {
    return listing.type === 'service' ? 3 : 2;
  }

  if (preset.label === 'Products' && (listing.type === 'product' || listing.type === 'hybrid')) {
    return listing.type === 'product' ? 3 : 2;
  }

  if (preset.label === 'Hybrid' && listing.type === 'hybrid') {
    return 3;
  }

  return 0;
}

function getRecommendationMatch(
  listing: {
    type: 'product' | 'service' | 'hybrid';
    is_local_only?: boolean | null;
  },
  preset: { label: 'Local-First' | 'Services' | 'Hybrid' | 'Products' } | null,
) {
  const score = getRecommendationScore(listing, preset);
  if (score === 0 || !preset) {
    return null;
  }

  if (preset.label === 'Local-First') {
    return { score, label: 'Local match' };
  }

  if (preset.label === 'Services') {
    return { score, label: 'Service fit' };
  }

  if (preset.label === 'Products') {
    return { score, label: 'Product fit' };
  }

  return { score, label: 'Hybrid fit' };
}

export default function TransactionReceiptScreen() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  const router = useRouter();
  const {
    session,
    listings,
    orders,
    bookings,
    notifications,
    notificationDeliveries,
    bulkRetryNotificationDeliveries,
  } = useBuyerSession();
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [receiptBooking, setReceiptBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryingRelatedDeliveries, setRetryingRelatedDeliveries] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionDetails, setActionDetails] = useState<string[]>([]);
  const [deliveryRetryMode, setDeliveryRetryModeState] = useState<'best_effort' | 'atomic'>('best_effort');
  const [recentTransactionReceiptIds, setRecentTransactionReceiptIds] = useState<string[]>([]);
  const [recentTransactionReceiptFilter, setRecentTransactionReceiptFilter] = useState<'all' | 'order' | 'booking'>('all');
  const currentReceiptKey = kind && id ? `${kind}:${id}` : null;

  const order = kind === 'order' && id ? orders.find((item) => item.id === id) : undefined;
  const booking = kind === 'booking' && id ? bookings.find((item) => item.id === id) : undefined;
  const relatedNotifications = notifications.filter(
    (item) => item.transactionKind === kind && item.transactionId === id,
  );
  const relatedDeliveries = notificationDeliveries.filter(
    (item) => item.transaction_kind === kind && item.transaction_id === id,
  );
  const failedRelatedDeliveries = relatedDeliveries.filter(
    (item) => item.delivery_status === 'failed',
  );
  const recommendedPreset = useMemo(
    () => getRecommendedBrowsePreset({ listings, orders, bookings }),
    [bookings, listings, orders],
  );
  const currentListingId = useMemo(() => {
    if (kind === 'booking') {
      return booking?.listing_id ?? receiptBooking?.listing_id ?? null;
    }

    return order?.items?.[0]?.listing_id ?? receiptOrder?.items?.[0]?.listing_id ?? null;
  }, [booking?.listing_id, kind, order?.items, receiptBooking?.listing_id, receiptOrder?.items]);
  const currentSellerId = useMemo(() => {
    if (kind === 'booking') {
      return booking?.seller_id ?? receiptBooking?.seller_id ?? null;
    }

    return order?.seller_id ?? receiptOrder?.seller_id ?? null;
  }, [booking?.seller_id, kind, order?.seller_id, receiptBooking?.seller_id, receiptOrder?.seller_id]);
  const moreLikeThisListings = useMemo(() => {
    return listings
      .filter((item) => item.id !== currentListingId)
      .map((item) => ({
        listing: item,
        match: getRecommendationMatch(item, recommendedPreset),
      }))
      .filter((item): item is { listing: (typeof listings)[number]; match: { score: number; label: string } } =>
        Boolean(item.match),
      )
      .sort((left, right) => {
        const rightSellerPriority = getSuggestionSellerPriority(right.listing, currentSellerId);
        const leftSellerPriority = getSuggestionSellerPriority(left.listing, currentSellerId);
        if (rightSellerPriority !== leftSellerPriority) {
          return rightSellerPriority - leftSellerPriority;
        }

        if (right.match.score !== left.match.score) {
          return right.match.score - left.match.score;
        }

        return new Date(right.listing.created_at).getTime() - new Date(left.listing.created_at).getTime();
      })
      .slice(0, 3)
      .map((item) => ({ ...item.listing, recommendationLabel: item.match.label }));
  }, [currentListingId, currentSellerId, listings, recommendedPreset]);
  const sameSellerSuggestions = useMemo(
    () =>
      currentSellerId
        ? moreLikeThisListings.filter((item) => item.seller_id === currentSellerId)
        : [],
    [currentSellerId, moreLikeThisListings],
  );
  const otherSellerSuggestions = useMemo(
    () =>
      currentSellerId
        ? moreLikeThisListings.filter((item) => item.seller_id !== currentSellerId)
        : moreLikeThisListings,
    [currentSellerId, moreLikeThisListings],
  );
  const latestRecentTransactionReceipt = useMemo(() => {
    const latestKey = recentTransactionReceiptIds.find((item) => item !== currentReceiptKey) ?? null;
    if (!latestKey) {
      return null;
    }

    const [latestKind, latestId] = latestKey.split(':');
    if (latestKind === 'order') {
      const latestOrder = orders.find((item) => item.id === latestId);
      if (latestOrder) {
        return {
          kind: 'order' as const,
          id: latestOrder.id,
          label: 'Order',
          meta: latestOrder.status.replaceAll('_', ' '),
        };
      }
    }

    if (latestKind === 'booking') {
      const latestBooking = bookings.find((item) => item.id === latestId);
      if (latestBooking) {
        return {
          kind: 'booking' as const,
          id: latestBooking.id,
          label: 'Booking',
          meta: latestBooking.status.replaceAll('_', ' '),
        };
      }
    }

    return null;
  }, [bookings, currentReceiptKey, orders, recentTransactionReceiptIds]);
  const recentTransactionReceipts = useMemo(() => {
    return recentTransactionReceiptIds
      .map((itemKey) => {
        const [itemKind, itemId] = itemKey.split(':');
        if (itemKind === 'order') {
          const matchingOrder = orders.find((item) => item.id === itemId);
          if (matchingOrder) {
            return {
              kind: 'order' as const,
              id: matchingOrder.id,
              label: 'Order',
              meta: matchingOrder.status,
            };
          }
        }

        if (itemKind === 'booking') {
          const matchingBooking = bookings.find((item) => item.id === itemId);
          if (matchingBooking) {
            return {
              kind: 'booking' as const,
              id: matchingBooking.id,
              label: 'Booking',
              meta: matchingBooking.status,
            };
          }
        }

        return null;
      })
      .filter(
        (item): item is { kind: 'order' | 'booking'; id: string; label: string; meta: string } =>
          Boolean(item),
      );
  }, [bookings, orders, recentTransactionReceiptIds]);
  const visibleRecentTransactionReceipts = useMemo(
    () =>
      recentTransactionReceipts.filter(
        (item) => recentTransactionReceiptFilter === 'all' || item.kind === recentTransactionReceiptFilter,
      ),
    [recentTransactionReceiptFilter, recentTransactionReceipts],
  );
  const recentTransactionReceiptCounts = useMemo(
    () => ({
      all: recentTransactionReceipts.length,
      order: recentTransactionReceipts.filter((item) => item.kind === 'order').length,
      booking: recentTransactionReceipts.filter((item) => item.kind === 'booking').length,
    }),
    [recentTransactionReceipts],
  );

  useEffect(() => {
    void (async () => {
      const storedRetryMode = await getBuyerDeliveryRetryMode();
      setDeliveryRetryModeState(storedRetryMode === 'atomic' ? 'atomic' : 'best_effort');
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const storedValue = await getBuyerRecentTransactionReceipts();
      if (!storedValue) {
        return;
      }

      try {
        const storedRecentReceipts = JSON.parse(storedValue) as string[];
        if (Array.isArray(storedRecentReceipts)) {
          setRecentTransactionReceiptIds(
            storedRecentReceipts.filter((item) => typeof item === 'string'),
          );
        }
      } catch {
        // Ignore corrupted recent-receipt state.
      }
    })();
  }, []);

  function setDeliveryRetryMode(mode: 'best_effort' | 'atomic') {
    setDeliveryRetryModeState(mode);
    void setBuyerDeliveryRetryMode(mode);
  }

  function retryFailedRelatedDeliveries() {
    if (failedRelatedDeliveries.length === 0) {
      return;
    }

    void (async () => {
      try {
        setActionError(null);
        setActionMessage(null);
        setActionDetails([]);
        setRetryingRelatedDeliveries(true);
        const result = await bulkRetryNotificationDeliveries(
          failedRelatedDeliveries.map((delivery) => delivery.id),
          deliveryRetryMode,
        );

        setActionMessage(
          result.failed.length === 0
            ? `Retried ${result.succeeded_ids.length} failed ${
                result.succeeded_ids.length === 1 ? 'delivery' : 'deliveries'
              } for this transaction using ${formatRetryMode(deliveryRetryMode)} mode.`
            : result.succeeded_ids.length > 0
              ? `Retried ${result.succeeded_ids.length} of ${failedRelatedDeliveries.length} failed deliveries for this transaction using ${formatRetryMode(deliveryRetryMode)} mode. ${result.failed.length} failed again.`
              : `Unable to retry ${failedRelatedDeliveries.length} failed deliveries for this transaction using ${formatRetryMode(deliveryRetryMode)} mode.`,
        );
        setActionDetails(
          result.failed.map(
            (failure: { id: string; detail: string }) =>
              `${failure.id.slice(0, 8)} · ${failure.detail}`,
          ),
        );
      } catch (error: unknown) {
        setActionError(
          error instanceof Error ? error.message : 'Unable to retry failed delivery attempts.',
        );
        setActionDetails([]);
      } finally {
        setRetryingRelatedDeliveries(false);
      }
    })();
  }

  function handleKeepBrowsingLane() {
    if (!recommendedPreset) {
      return;
    }

    void setBuyerBrowseFilters(
      JSON.stringify({
        searchQuery: '',
        typeFilter: recommendedPreset.label === 'Services'
          ? 'service'
          : recommendedPreset.label === 'Products'
            ? 'product'
            : recommendedPreset.label === 'Hybrid'
              ? 'hybrid'
              : 'all',
        sortMode: 'newest',
        localOnly: recommendedPreset.label === 'Local-First',
      }),
    );

    router.push('/');
  }

  useEffect(() => {
    let cancelled = false;

    if (!session?.access_token || !id) {
      return () => {
        cancelled = true;
      };
    }

    if (kind === 'order') {
      if (order) {
        setReceiptOrder(order);
        setLoadError(null);
        return () => {
          cancelled = true;
        };
      }

      setLoading(true);
      setLoadError(null);

      void loadBuyerOrder(session.access_token, id)
        .then((result) => {
          if (cancelled) {
            return;
          }

          setReceiptOrder(result);
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }

          setLoadError(error instanceof Error ? error.message : 'Unable to load this order receipt.');
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }

    if (kind === 'booking') {
      if (booking) {
        setReceiptBooking(booking);
        setLoadError(null);
        return () => {
          cancelled = true;
        };
      }

      setLoading(true);
      setLoadError(null);

      void loadBuyerBooking(session.access_token, id)
        .then((result) => {
          if (cancelled) {
            return;
          }

          setReceiptBooking(result);
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }

          setLoadError(error instanceof Error ? error.message : 'Unable to load this booking receipt.');
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [booking, id, kind, order, session?.access_token]);

  useEffect(() => {
    if (!kind || !id) {
      return;
    }

    void (async () => {
      try {
        const receiptKey = `${kind}:${id}`;
        const nextIds = [
          receiptKey,
          ...recentTransactionReceiptIds.filter((item) => item !== receiptKey),
        ].slice(0, 4);
        setRecentTransactionReceiptIds(nextIds);
        await setBuyerRecentTransactionReceipts(JSON.stringify(nextIds));
      } catch {
        // Ignore unavailable recent-receipt state.
      }
    })();
  }, [id, kind, recentTransactionReceiptIds]);

  if (kind === 'order') {
    const resolvedOrder = order ?? receiptOrder;
    if (loading && !resolvedOrder) {
      return <LoadingReceipt message="Loading order receipt..." />;
    }

    if (!resolvedOrder) {
      return (
        <MissingReceipt
          message={loadError ?? 'Order receipt is not loaded yet. Return to Buyer and refresh activity.'}
        />
      );
    }

    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Order receipt</Text>
          <Text style={styles.title}>Order submitted successfully.</Text>
          <Text style={styles.subtitle}>
            The seller queue now has this order and can start moving it through the workflow.
          </Text>
          {latestRecentTransactionReceipt ? (
            <Pressable
              style={styles.heroAction}
              onPress={() => {
                router.push({
                  pathname: '/transactions/[kind]/[id]',
                  params: { kind: latestRecentTransactionReceipt.kind, id: latestRecentTransactionReceipt.id },
                });
              }}>
              <Text style={styles.heroActionText}>
                Open latest receipt · {latestRecentTransactionReceipt.label} · {latestRecentTransactionReceipt.meta}
              </Text>
            </Pressable>
          ) : null}
          {recommendedPreset ? (
            <Pressable style={styles.heroAction} onPress={handleKeepBrowsingLane}>
              <Text style={styles.heroActionText}>Keep Browsing This Lane</Text>
            </Pressable>
          ) : null}
        </View>

        {recentTransactionReceiptIds.length > 0 ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Recently Opened Receipts</Text>
              <Pressable
                style={styles.inlineAction}
                onPress={async () => {
                  setRecentTransactionReceiptIds([]);
                  await clearBuyerRecentTransactionReceipts();
                }}>
                <Text style={styles.inlineActionText}>Clear saved receipt history</Text>
              </Pressable>
            </View>
            <View style={styles.modeSwitchRow}>
              {(
                [
                  ['all', 'All'],
                  ['order', 'Orders'],
                  ['booking', 'Bookings'],
                ] as const
              ).map(([filter, label]) => (
                <Pressable
                  key={filter}
                  style={[
                    styles.inlineAction,
                    recentTransactionReceiptFilter === filter && styles.inlineActionActive,
                  ]}
                  onPress={() => setRecentTransactionReceiptFilter(filter)}>
                  <Text
                    style={[
                      styles.inlineActionText,
                      recentTransactionReceiptFilter === filter && styles.inlineActionTextActive,
                    ]}>
                    {label}
                    {' '}
                    ·
                    {' '}
                    {filter === 'all'
                      ? recentTransactionReceiptCounts.all
                      : recentTransactionReceiptCounts[filter]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.recentList}>
              {visibleRecentTransactionReceipts.length > 0 ? (
                visibleRecentTransactionReceipts.map((receipt) => (
                  <Pressable
                    key={`${receipt.kind}:${receipt.id}`}
                    style={styles.recentCard}
                    onPress={() =>
                      router.push({
                        pathname: '/transactions/[kind]/[id]',
                        params: { kind: receipt.kind, id: receipt.id },
                      })
                    }>
                    <Text style={styles.lineTitle}>
                      {receipt.label} · {receipt.meta}
                    </Text>
                    <Text style={styles.lineMeta}>
                      {receipt.kind} · {receipt.id}
                    </Text>
                  </Pressable>
                ))
              ) : (
                <Text style={styles.emptyText}>No saved receipts match this filter.</Text>
              )}
            </View>
          </View>
        ) : null}

        {moreLikeThisListings.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>More Like This</Text>
            {sameSellerSuggestions.length > 0 ? (
              <View style={styles.suggestionGroup}>
                {otherSellerSuggestions.length > 0 ? (
                  <Text style={styles.suggestionGroupTitle}>More from this seller</Text>
                ) : null}
                {sameSellerSuggestions.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() =>
                      router.push({
                        pathname: '/listings/[id]',
                        params: { id: item.id, followOn: getSuggestionFollowOn(item, currentSellerId) },
                      })
                    }
                    style={styles.linkCard}>
                    <View style={styles.suggestionRow}>
                      {getPrimaryImageUrl(item) ? (
                        <Image source={{ uri: getPrimaryImageUrl(item)! }} style={styles.suggestionImage} />
                      ) : (
                        <View style={styles.suggestionImagePlaceholder}>
                          <Text style={styles.suggestionImagePlaceholderText}>{item.type}</Text>
                        </View>
                      )}
                      <View style={styles.suggestionBody}>
                        <View style={styles.suggestionHeader}>
                          <Text style={styles.lineTitle}>{item.title}</Text>
                          <Text style={styles.suggestionSignal}>{getSuggestionSecondarySignal(item)}</Text>
                        </View>
                        <Text style={styles.lineMeta}>
                          {item.type} · {item.is_local_only ? 'Local Only' : 'Open Reach'}
                        </Text>
                        <View style={styles.suggestionBadgeRow}>
                          <Text style={styles.lineReason}>{item.recommendationLabel}</Text>
                          <Text style={styles.suggestionMode}>{getSuggestionActionMode(item)}</Text>
                          <Text style={styles.suggestionSeller}>
                            {getSuggestionSellerLabel(item, currentSellerId)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {otherSellerSuggestions.length > 0 ? (
              <View style={styles.suggestionGroup}>
                {sameSellerSuggestions.length > 0 ? (
                  <Text style={styles.suggestionGroupTitle}>Explore similar listings</Text>
                ) : null}
                {otherSellerSuggestions.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() =>
                      router.push({
                        pathname: '/listings/[id]',
                        params: { id: item.id, followOn: getSuggestionFollowOn(item, currentSellerId) },
                      })
                    }
                    style={styles.linkCard}>
                    <View style={styles.suggestionRow}>
                      {getPrimaryImageUrl(item) ? (
                        <Image source={{ uri: getPrimaryImageUrl(item)! }} style={styles.suggestionImage} />
                      ) : (
                        <View style={styles.suggestionImagePlaceholder}>
                          <Text style={styles.suggestionImagePlaceholderText}>{item.type}</Text>
                        </View>
                      )}
                      <View style={styles.suggestionBody}>
                        <View style={styles.suggestionHeader}>
                          <Text style={styles.lineTitle}>{item.title}</Text>
                          <Text style={styles.suggestionSignal}>{getSuggestionSecondarySignal(item)}</Text>
                        </View>
                        <Text style={styles.lineMeta}>
                          {item.type} · {item.is_local_only ? 'Local Only' : 'Open Reach'}
                        </Text>
                        <View style={styles.suggestionBadgeRow}>
                          <Text style={styles.lineReason}>{item.recommendationLabel}</Text>
                          <Text style={styles.suggestionMode}>{getSuggestionActionMode(item)}</Text>
                          <Text style={styles.suggestionSeller}>
                            {getSuggestionSellerLabel(item, currentSellerId)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {actionError ? <Text style={styles.feedbackError}>{actionError}</Text> : null}
        {actionMessage ? <Text style={styles.feedbackSuccess}>{actionMessage}</Text> : null}
        {actionDetails.length > 0 ? (
          <View style={styles.feedbackList}>
            {actionDetails.slice(0, 4).map((detail) => (
              <Text key={detail} style={styles.feedbackDetailText}>
                {detail}
              </Text>
            ))}
            {actionDetails.length > 4 ? (
              <Text style={styles.feedbackDetailText}>
                {actionDetails.length - 4} more not shown.
              </Text>
            ) : null}
          </View>
        ) : null}

        {failedRelatedDeliveries.length > 0 ? (
          <View style={styles.feedbackList}>
            <Text style={styles.feedbackDetailText}>
              Retry mode: {formatRetryMode(deliveryRetryMode)}
            </Text>
            <View style={styles.modeSwitchRow}>
              <Pressable
                style={[styles.inlineAction, deliveryRetryMode === 'best_effort' && styles.inlineActionActive]}
                onPress={() => setDeliveryRetryMode('best_effort')}>
                <Text style={[styles.inlineActionText, deliveryRetryMode === 'best_effort' && styles.inlineActionTextActive]}>
                  Best Effort
                </Text>
              </Pressable>
              <Pressable
                style={[styles.inlineAction, deliveryRetryMode === 'atomic' && styles.inlineActionActive]}
                onPress={() => setDeliveryRetryMode('atomic')}>
                <Text style={[styles.inlineActionText, deliveryRetryMode === 'atomic' && styles.inlineActionTextActive]}>
                  Validate First
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Summary</Text>
          <ReceiptRow label="Order ID" value={resolvedOrder.id} />
          <ReceiptRow label="Status" value={resolvedOrder.status.replaceAll('_', ' ')} />
          <ReceiptRow label="Fulfillment" value={resolvedOrder.fulfillment} />
          <ReceiptRow
            label="Subtotal"
            value={formatCurrency(resolvedOrder.subtotal_cents, resolvedOrder.currency)}
          />
          {(resolvedOrder.fulfillment === 'delivery' || resolvedOrder.fulfillment === 'shipping') ? (
            <ReceiptRow
              label={
                resolvedOrder.fulfillment === 'shipping'
                  ? 'Platform-added shipping fee'
                  : 'Platform-added delivery fee'
              }
              value={formatCurrency(resolvedOrder.delivery_fee_cents, resolvedOrder.currency)}
            />
          ) : null}
          <ReceiptRow
            label="Platform fee"
            value={formatCurrency(resolvedOrder.platform_fee_cents, resolvedOrder.currency)}
          />
          <ReceiptRow label="Total" value={formatCurrency(resolvedOrder.total_cents, resolvedOrder.currency)} />
          <ReceiptRow
            label="Seller update"
            value={resolvedOrder.seller_response_note ?? 'No seller note yet'}
          />
          <ReceiptRow label="Notes" value={resolvedOrder.notes ?? 'No notes added'} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Requested items</Text>
          {(resolvedOrder.items ?? []).length > 0 ? (
            (resolvedOrder.items ?? []).map((item) => (
              <View key={item.id} style={styles.lineItem}>
                <Text style={styles.lineTitle}>{item.quantity}x {item.listing_title ?? item.listing_id}</Text>
                <Text style={styles.lineMeta}>
                  {formatCurrency(item.total_price_cents, resolvedOrder.currency)}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>Item detail is not available for this order yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Timeline</Text>
          {(resolvedOrder.status_history ?? []).length > 0 ? (
            (resolvedOrder.status_history ?? []).map((event) => (
              <View key={event.id} style={styles.timelineItem}>
                <Text style={styles.lineTitle}>
                  {event.status.replaceAll('_', ' ')} · {event.actor_role}
                </Text>
                <Text style={styles.lineMeta}>{new Date(event.created_at).toLocaleString()}</Text>
                {event.note ? <Text style={styles.rowValue}>{event.note}</Text> : null}
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No transaction history yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Related Updates</Text>
          {relatedNotifications.length > 0 ? (
            relatedNotifications.slice(0, 4).map((notification) => (
              <View key={notification.id} style={styles.timelineItem}>
                <Text style={styles.lineTitle}>{notification.title}</Text>
                <Text style={styles.lineMeta}>{new Date(notification.createdAt).toLocaleString()}</Text>
                <Text style={styles.rowValue}>{notification.message}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No related seller updates yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Delivery Attempts</Text>
            {failedRelatedDeliveries.length > 0 ? (
              <Pressable style={styles.inlineAction} onPress={retryFailedRelatedDeliveries}>
                <Text style={styles.inlineActionText}>
                  {retryingRelatedDeliveries ? 'Retrying...' : `Retry Failed · ${failedRelatedDeliveries.length}`}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <Pressable
            style={styles.modeBadge}
            onPress={() => setDeliveryRetryMode(toggleRetryMode(deliveryRetryMode))}>
            <Text style={styles.modeBadgeLabel}>Retry Mode</Text>
            <Text style={styles.modeBadgeValue}>{formatRetryMode(deliveryRetryMode)}</Text>
            <Text style={styles.modeBadgeHint}>Tap to switch</Text>
          </Pressable>
          {relatedDeliveries.length > 0 ? (
            relatedDeliveries.slice(0, 4).map((delivery) => (
              <Pressable
                key={delivery.id}
                onPress={() =>
                  router.push({
                    pathname: '/notifications/[id]',
                    params: { id: delivery.id },
                  })
                }
                style={styles.linkCard}>
                <Text style={styles.lineTitle}>
                  {delivery.channel} · {delivery.delivery_status}
                </Text>
                <Text style={styles.lineMeta}>
                  {new Date(delivery.created_at).toLocaleString()} · attempts {delivery.attempts}
                </Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.emptyText}>No notification deliveries recorded for this order yet.</Text>
          )}
        </View>
      </ScrollView>
    );
  }

  if (kind === 'booking') {
    const resolvedBooking = booking ?? receiptBooking;
    if (loading && !resolvedBooking) {
      return <LoadingReceipt message="Loading booking receipt..." />;
    }

    if (!resolvedBooking) {
      return (
        <MissingReceipt
          message={loadError ?? 'Booking receipt is not loaded yet. Return to Buyer and refresh activity.'}
        />
      );
    }

    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Booking receipt</Text>
          <Text style={styles.title}>Booking request sent.</Text>
          <Text style={styles.subtitle}>
            The seller can now confirm, decline, or move this booking into progress from the web workspace.
          </Text>
          {latestRecentTransactionReceipt ? (
            <Pressable
              style={styles.heroAction}
              onPress={() => {
                router.push({
                  pathname: '/transactions/[kind]/[id]',
                  params: { kind: latestRecentTransactionReceipt.kind, id: latestRecentTransactionReceipt.id },
                });
              }}>
              <Text style={styles.heroActionText}>
                Open latest receipt · {latestRecentTransactionReceipt.label} · {latestRecentTransactionReceipt.meta}
              </Text>
            </Pressable>
          ) : null}
          {recommendedPreset ? (
            <Pressable style={styles.heroAction} onPress={handleKeepBrowsingLane}>
              <Text style={styles.heroActionText}>Keep Browsing This Lane</Text>
            </Pressable>
          ) : null}
        </View>

        {recentTransactionReceiptIds.length > 0 ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Recently Opened Receipts</Text>
              <Pressable
                style={styles.inlineAction}
                onPress={async () => {
                  setRecentTransactionReceiptIds([]);
                  await clearBuyerRecentTransactionReceipts();
                }}>
                <Text style={styles.inlineActionText}>Clear saved receipt history</Text>
              </Pressable>
            </View>
            <View style={styles.modeSwitchRow}>
              {(
                [
                  ['all', 'All'],
                  ['order', 'Orders'],
                  ['booking', 'Bookings'],
                ] as const
              ).map(([filter, label]) => (
                <Pressable
                  key={filter}
                  style={[
                    styles.inlineAction,
                    recentTransactionReceiptFilter === filter && styles.inlineActionActive,
                  ]}
                  onPress={() => setRecentTransactionReceiptFilter(filter)}>
                  <Text
                    style={[
                      styles.inlineActionText,
                      recentTransactionReceiptFilter === filter && styles.inlineActionTextActive,
                    ]}>
                    {label}
                    {' '}
                    ·
                    {' '}
                    {filter === 'all'
                      ? recentTransactionReceiptCounts.all
                      : recentTransactionReceiptCounts[filter]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.recentList}>
              {visibleRecentTransactionReceipts.length > 0 ? (
                visibleRecentTransactionReceipts.map((receipt) => (
                  <Pressable
                    key={`${receipt.kind}:${receipt.id}`}
                    style={styles.recentCard}
                    onPress={() =>
                      router.push({
                        pathname: '/transactions/[kind]/[id]',
                        params: { kind: receipt.kind, id: receipt.id },
                      })
                    }>
                    <Text style={styles.lineTitle}>
                      {receipt.label} · {receipt.meta}
                    </Text>
                    <Text style={styles.lineMeta}>
                      {receipt.kind} · {receipt.id}
                    </Text>
                  </Pressable>
                ))
              ) : (
                <Text style={styles.emptyText}>No saved receipts match this filter.</Text>
              )}
            </View>
          </View>
        ) : null}

        {moreLikeThisListings.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>More Like This</Text>
            {sameSellerSuggestions.length > 0 ? (
              <View style={styles.suggestionGroup}>
                {otherSellerSuggestions.length > 0 ? (
                  <Text style={styles.suggestionGroupTitle}>More from this seller</Text>
                ) : null}
                {sameSellerSuggestions.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() =>
                      router.push({
                        pathname: '/listings/[id]',
                        params: { id: item.id, followOn: getSuggestionFollowOn(item, currentSellerId) },
                      })
                    }
                    style={styles.linkCard}>
                    <View style={styles.suggestionRow}>
                      {getPrimaryImageUrl(item) ? (
                        <Image source={{ uri: getPrimaryImageUrl(item)! }} style={styles.suggestionImage} />
                      ) : (
                        <View style={styles.suggestionImagePlaceholder}>
                          <Text style={styles.suggestionImagePlaceholderText}>{item.type}</Text>
                        </View>
                      )}
                      <View style={styles.suggestionBody}>
                        <View style={styles.suggestionHeader}>
                          <Text style={styles.lineTitle}>{item.title}</Text>
                          <Text style={styles.suggestionSignal}>{getSuggestionSecondarySignal(item)}</Text>
                        </View>
                        <Text style={styles.lineMeta}>
                          {item.type} · {item.is_local_only ? 'Local Only' : 'Open Reach'}
                        </Text>
                        <View style={styles.suggestionBadgeRow}>
                          <Text style={styles.lineReason}>{item.recommendationLabel}</Text>
                          <Text style={styles.suggestionMode}>{getSuggestionActionMode(item)}</Text>
                          <Text style={styles.suggestionSeller}>
                            {getSuggestionSellerLabel(item, currentSellerId)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {otherSellerSuggestions.length > 0 ? (
              <View style={styles.suggestionGroup}>
                {sameSellerSuggestions.length > 0 ? (
                  <Text style={styles.suggestionGroupTitle}>Explore similar listings</Text>
                ) : null}
                {otherSellerSuggestions.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() =>
                      router.push({
                        pathname: '/listings/[id]',
                        params: { id: item.id, followOn: getSuggestionFollowOn(item, currentSellerId) },
                      })
                    }
                    style={styles.linkCard}>
                    <View style={styles.suggestionRow}>
                      {getPrimaryImageUrl(item) ? (
                        <Image source={{ uri: getPrimaryImageUrl(item)! }} style={styles.suggestionImage} />
                      ) : (
                        <View style={styles.suggestionImagePlaceholder}>
                          <Text style={styles.suggestionImagePlaceholderText}>{item.type}</Text>
                        </View>
                      )}
                      <View style={styles.suggestionBody}>
                        <View style={styles.suggestionHeader}>
                          <Text style={styles.lineTitle}>{item.title}</Text>
                          <Text style={styles.suggestionSignal}>{getSuggestionSecondarySignal(item)}</Text>
                        </View>
                        <Text style={styles.lineMeta}>
                          {item.type} · {item.is_local_only ? 'Local Only' : 'Open Reach'}
                        </Text>
                        <View style={styles.suggestionBadgeRow}>
                          <Text style={styles.lineReason}>{item.recommendationLabel}</Text>
                          <Text style={styles.suggestionMode}>{getSuggestionActionMode(item)}</Text>
                          <Text style={styles.suggestionSeller}>
                            {getSuggestionSellerLabel(item, currentSellerId)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {actionError ? <Text style={styles.feedbackError}>{actionError}</Text> : null}
        {actionMessage ? <Text style={styles.feedbackSuccess}>{actionMessage}</Text> : null}
        {actionDetails.length > 0 ? (
          <View style={styles.feedbackList}>
            {actionDetails.slice(0, 4).map((detail) => (
              <Text key={detail} style={styles.feedbackDetailText}>
                {detail}
              </Text>
            ))}
            {actionDetails.length > 4 ? (
              <Text style={styles.feedbackDetailText}>
                {actionDetails.length - 4} more not shown.
              </Text>
            ) : null}
          </View>
        ) : null}

        {failedRelatedDeliveries.length > 0 ? (
          <View style={styles.feedbackList}>
            <Text style={styles.feedbackDetailText}>
              Retry mode: {formatRetryMode(deliveryRetryMode)}
            </Text>
            <View style={styles.modeSwitchRow}>
              <Pressable
                style={[styles.inlineAction, deliveryRetryMode === 'best_effort' && styles.inlineActionActive]}
                onPress={() => setDeliveryRetryMode('best_effort')}>
                <Text style={[styles.inlineActionText, deliveryRetryMode === 'best_effort' && styles.inlineActionTextActive]}>
                  Best Effort
                </Text>
              </Pressable>
              <Pressable
                style={[styles.inlineAction, deliveryRetryMode === 'atomic' && styles.inlineActionActive]}
                onPress={() => setDeliveryRetryMode('atomic')}>
                <Text style={[styles.inlineActionText, deliveryRetryMode === 'atomic' && styles.inlineActionTextActive]}>
                  Validate First
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Summary</Text>
          <ReceiptRow label="Booking ID" value={resolvedBooking.id} />
          <ReceiptRow label="Status" value={resolvedBooking.status.replaceAll('_', ' ')} />
          <ReceiptRow label="Listing" value={resolvedBooking.listing_title ?? resolvedBooking.listing_id} />
          <ReceiptRow label="Type" value={resolvedBooking.listing_type ?? 'Not specified'} />
          <ReceiptRow label="Starts" value={new Date(resolvedBooking.scheduled_start).toLocaleString()} />
          <ReceiptRow label="Ends" value={new Date(resolvedBooking.scheduled_end).toLocaleString()} />
          <ReceiptRow label="Price" value={formatCurrency(resolvedBooking.total_cents, resolvedBooking.currency)} />
          <ReceiptRow
            label="Seller update"
            value={resolvedBooking.seller_response_note ?? 'No seller note yet'}
          />
          <ReceiptRow label="Notes" value={resolvedBooking.notes ?? 'No notes added'} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Timeline</Text>
          {(resolvedBooking.status_history ?? []).length > 0 ? (
            (resolvedBooking.status_history ?? []).map((event) => (
              <View key={event.id} style={styles.timelineItem}>
                <Text style={styles.lineTitle}>
                  {event.status.replaceAll('_', ' ')} · {event.actor_role}
                </Text>
                <Text style={styles.lineMeta}>{new Date(event.created_at).toLocaleString()}</Text>
                {event.note ? <Text style={styles.rowValue}>{event.note}</Text> : null}
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No transaction history yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Related Updates</Text>
          {relatedNotifications.length > 0 ? (
            relatedNotifications.slice(0, 4).map((notification) => (
              <View key={notification.id} style={styles.timelineItem}>
                <Text style={styles.lineTitle}>{notification.title}</Text>
                <Text style={styles.lineMeta}>{new Date(notification.createdAt).toLocaleString()}</Text>
                <Text style={styles.rowValue}>{notification.message}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No related seller updates yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Delivery Attempts</Text>
            {failedRelatedDeliveries.length > 0 ? (
              <Pressable style={styles.inlineAction} onPress={retryFailedRelatedDeliveries}>
                <Text style={styles.inlineActionText}>
                  {retryingRelatedDeliveries ? 'Retrying...' : `Retry Failed · ${failedRelatedDeliveries.length}`}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <Pressable
            style={styles.modeBadge}
            onPress={() => setDeliveryRetryMode(toggleRetryMode(deliveryRetryMode))}>
            <Text style={styles.modeBadgeLabel}>Retry Mode</Text>
            <Text style={styles.modeBadgeValue}>{formatRetryMode(deliveryRetryMode)}</Text>
            <Text style={styles.modeBadgeHint}>Tap to switch</Text>
          </Pressable>
          {relatedDeliveries.length > 0 ? (
            relatedDeliveries.slice(0, 4).map((delivery) => (
              <Pressable
                key={delivery.id}
                onPress={() =>
                  router.push({
                    pathname: '/notifications/[id]',
                    params: { id: delivery.id },
                  })
                }
                style={styles.linkCard}>
                <Text style={styles.lineTitle}>
                  {delivery.channel} · {delivery.delivery_status}
                </Text>
                <Text style={styles.lineMeta}>
                  {new Date(delivery.created_at).toLocaleString()} · attempts {delivery.attempts}
                </Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.emptyText}>No notification deliveries recorded for this booking yet.</Text>
          )}
        </View>
      </ScrollView>
    );
  }

  return <MissingReceipt message="This receipt type is not supported." />;
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function MissingReceipt({ message }: { message: string }) {
  return (
    <View style={styles.missingState}>
      <Text style={styles.missingTitle}>Receipt unavailable</Text>
      <Text style={styles.missingText}>{message}</Text>
    </View>
  );
}

function LoadingReceipt({ message }: { message: string }) {
  return (
    <View style={styles.missingState}>
      <ActivityIndicator size="large" color="#1f351f" />
      <Text style={styles.missingTitle}>Loading receipt</Text>
      <Text style={styles.missingText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#efe4cf',
  },
  content: {
    padding: 18,
    gap: 18,
  },
  hero: {
    backgroundColor: '#1f351f',
    borderRadius: 26,
    padding: 20,
    gap: 10,
  },
  heroAction: {
    alignSelf: 'flex-start',
    backgroundColor: '#2a472a',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  heroActionText: {
    color: '#fff0d2',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  eyebrow: {
    color: '#f6d999',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: {
    color: '#fff8ee',
    fontSize: 29,
    fontWeight: '700',
    lineHeight: 34,
  },
  subtitle: {
    color: '#d7d3c8',
    fontSize: 14,
    lineHeight: 22,
  },
  card: {
    backgroundColor: '#fff8ee',
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  recentList: {
    gap: 10,
  },
  recentCard: {
    backgroundColor: '#fbf4e4',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e4d6bf',
    gap: 6,
    padding: 14,
  },
  cardTitle: {
    color: '#1f2319',
    fontSize: 20,
    fontWeight: '700',
  },
  modeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#f4eadb',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  modeBadgeLabel: {
    color: '#6f6556',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  modeBadgeValue: {
    color: '#1f2319',
    fontSize: 14,
    fontWeight: '700',
  },
  modeBadgeHint: {
    color: '#6f6556',
    fontSize: 11,
  },
  inlineAction: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d8c8af',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inlineActionText: {
    color: '#4d4338',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  inlineActionActive: {
    backgroundColor: '#1f351f',
    borderColor: '#1f351f',
  },
  inlineActionTextActive: {
    color: '#fff8ee',
  },
  row: {
    gap: 4,
  },
  rowLabel: {
    color: '#7a6d5a',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  rowValue: {
    color: '#322d25',
    fontSize: 14,
    lineHeight: 21,
  },
  lineItem: {
    borderTopWidth: 1,
    borderTopColor: '#ebddc5',
    paddingTop: 12,
    gap: 4,
  },
  timelineItem: {
    borderTopWidth: 1,
    borderTopColor: '#ebddc5',
    paddingTop: 12,
    gap: 4,
  },
  linkCard: {
    borderTopWidth: 1,
    borderTopColor: '#ebddc5',
    paddingTop: 12,
    gap: 4,
  },
  suggestionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  suggestionImage: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: '#e8dcc9',
  },
  suggestionImagePlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: '#d9c7a8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionImagePlaceholderText: {
    color: '#4d4338',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  suggestionBody: {
    flex: 1,
    gap: 4,
  },
  suggestionGroup: {
    gap: 8,
  },
  suggestionGroupTitle: {
    color: '#5f5548',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  suggestionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center',
  },
  lineTitle: {
    color: '#1f2319',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  lineMeta: {
    color: '#6f6556',
    fontSize: 13,
  },
  suggestionSignal: {
    color: '#1f2319',
    fontSize: 11,
    fontWeight: '700',
  },
  suggestionBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  suggestionMode: {
    color: '#7c3a10',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  suggestionSeller: {
    color: '#5d5a7a',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  lineReason: {
    color: '#0f5f62',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  emptyText: {
    color: '#6f6556',
    fontSize: 14,
    lineHeight: 21,
  },
  missingState: {
    flex: 1,
    backgroundColor: '#efe4cf',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  missingTitle: {
    color: '#1f2319',
    fontSize: 24,
    fontWeight: '700',
  },
  missingText: {
    color: '#5f5548',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
  feedbackError: {
    color: '#a13428',
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 4,
  },
  feedbackSuccess: {
    color: '#1f351f',
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 4,
  },
  feedbackList: {
    gap: 4,
    paddingHorizontal: 4,
  },
  modeSwitchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  feedbackDetailText: {
    color: '#5f5548',
    fontSize: 12,
    lineHeight: 18,
  },
});
