<script lang="ts">
  export let message = '';
  export let retry: (() => void) | undefined;
</script>

<section class="status-notice" role="alert">
  <span>{message}</span>
  {#if retry}<button type="button" on:click={retry}>Retry</button>{/if}
</section>

<style>.status-notice{display:flex;gap:.75rem;align-items:center;padding:.65rem .8rem;color:#2d2200;background:repeating-linear-gradient(-45deg,#fff5c4,#fff5c4 8px,#f8e3a1 8px,#f8e3a1 16px);border:1px solid #a77000}.status-notice button{margin-left:auto}</style>
