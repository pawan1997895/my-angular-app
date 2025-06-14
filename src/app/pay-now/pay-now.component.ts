import { Component, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { timeout } from 'rxjs/operators';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-pay-now',
  standalone: true,
  imports: [FormsModule, HttpClientModule, CommonModule],
  templateUrl: './pay-now.component.html',
  styleUrls: ['./pay-now.component.css']
})
export class PayNowComponent {
  accountNumber: string = '';
  phoneNumber: string = '';
  consumerDetails: { name: string; dueDate: string; amount: number } | null = null;
  errorMessage: SafeHtml | string | null = null;
  isLoading: boolean = false;

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer
  ) {}

  get isPhoneNumberValid(): boolean {
    return !this.phoneNumber || /^\d{10}$/.test(this.phoneNumber);
  }

  restrictToNumber(event: Event): void {
    const input = event.target as HTMLInputElement;
    let value = input.value.replace(/[^0-9.]/g, ''); // Allow numbers and decimal point
    const parts = value.split('.');
    if (parts.length > 2) {
      value = `${parts[0]}.${parts[1]}`; // Limit to one decimal point
    }
    if (parts[1] && parts[1].length > 2) {
      value = `${parts[0]}.${parts[1].substring(0, 2)}`; // Limit to 2 decimal places
    }
    input.value = value;
    if (this.consumerDetails) {
      this.consumerDetails.amount = parseFloat(value) || 0;
      this.cdr.detectChanges();
    }
  }

  onGetDetails() {
    if (!this.accountNumber) {
      this.errorMessage = 'Please enter an account number';
      this.consumerDetails = null;
      return;
    }

    if (this.isLoading) return;

    this.isLoading = true;
    this.errorMessage = null;
    this.consumerDetails = null;
    this.phoneNumber = '';

    console.log('Fetching details for account number:', this.accountNumber);

    const apiUrl = `https://api.perfectfinmart.xyz/api/v1/wp-payment?FileNumber=${encodeURIComponent(this.accountNumber)}`;

    this.http.get(apiUrl)
      .pipe(timeout(5000))
      .subscribe({
        next: (response: any) => {
          console.log('API Response:', response);

          if (response.message !== 'SUCCESS') {
            this.errorMessage = response.message || 'An error occurred while fetching details.';
            this.consumerDetails = null;
          } else {
            const payload = response.data?.payload;
            if (payload) {
              this.consumerDetails = {
                name: payload.customerDetails?.name || 'Unknown Name',
                dueDate: payload.dueDate || 'Unknown Due Date',
                amount: parseFloat(payload.totalAmount) || 0
              };
              this.phoneNumber = payload.customerDetails?.phoneNumber || '';
              this.errorMessage = null;
              this.cdr.detectChanges();
            } else {
              this.errorMessage = 'No data found for this account number.';
              this.consumerDetails = null;
            }
          }
        },
        error: (error) => {
          console.error('Error fetching details:', error);
          this.errorMessage = error.name === 'TimeoutError'
            ? 'Request timed out. Please try again or check your network.'
            : error.status === 0
              ? 'CORS error: Unable to reach the server. Please check your network or contact support.'
              : error.status === 401 || error.status === 403
                ? 'Authorization error: Invalid or expired token. Please contact support.'
                : `Failed to fetch details: ${error.message || 'Unknown error'}`;
          this.consumerDetails = null;
          this.isLoading = false;
          this.cdr.detectChanges();
        },
        complete: () => {
          this.isLoading = false;
          this.cdr.detectChanges();
        }
      });
  }

  onProceedToPay() {
    if (!this.consumerDetails) {
      this.errorMessage = 'No consumer details available to proceed with payment.';
      return;
    }

    if (this.isLoading) return;

    this.isLoading = true;
    this.errorMessage = null;

    console.log('Initiating payment for:', this.consumerDetails);

    const paymentPayload: any = {
      name: this.consumerDetails.name,
      fileNumber: this.accountNumber,
      amount: this.consumerDetails.amount
    };

    if (this.phoneNumber && this.isPhoneNumberValid) {
      paymentPayload.number = this.phoneNumber;
    }

    // Open a temporary window to avoid popup blocker
    const tempWindow = window.open('', '_blank');
    if (!tempWindow) {
      this.errorMessage = this.sanitizer.bypassSecurityTrustHtml(
        'Popup blocked. Please allow popups in Safari (Settings > Safari > Block Pop-ups > Off) and try again, or <a href="#" class="fallback-link">click here</a> to proceed with payment.'
      ) as string;
      this.isLoading = false;
      this.cdr.detectChanges();
      return;
    }

    const apiUrl = 'https://api.perfectfinmart.xyz/api/v1/wp-payment';

    this.http.post(apiUrl, paymentPayload, {
      headers: { 'Content-Type': 'application/json' }
    })
      .pipe(timeout(5000))
      .subscribe({
        next: (response: any) => {
          console.log('Payment API Response:', JSON.stringify(response, null, 2));

          if (response.message === 'Success' && response.data?.link) {
            try {
              const paymentUrl = new URL(response.data.link);
              tempWindow.location.href = paymentUrl.toString();
            } catch (error) {
              console.error('Invalid payment URL:', error);
              tempWindow.close();
              this.errorMessage = this.sanitizer.bypassSecurityTrustHtml(
                `Invalid payment URL. Please try again or <a href="${response.data.link}" class="fallback-link">click here</a> to proceed with payment.`
              ) as string;
              this.isLoading = false;
              this.cdr.detectChanges();
            }
          } else {
            tempWindow.close();
            this.errorMessage = 'Failed to generate payment link. Please try again.';
            this.isLoading = false;
            this.cdr.detectChanges();
          }
        },
        error: (error) => {
          console.error('Error initiating payment:', error);
          tempWindow.close();
          this.errorMessage = this.sanitizer.bypassSecurityTrustHtml(
            error.name === 'TimeoutError'
              ? 'Payment request timed out. Please try again.'
              : error.status === 0
                ? 'Unable to reach the payment server. Please check your network, allow popups in Safari (Settings > Safari > Block Pop-ups > Off), or <a href="#" class="fallback-link">click here</a> to proceed.'
                : error.status === 401 || error.status === 403
                  ? 'Authorization error: Unable to process payment. Please contact support.'
                  : `Failed to initiate payment: ${error.message || 'Unknown error'}`
          ) as string;
          this.isLoading = false;
          this.cdr.detectChanges();
        },
        complete: () => {
          this.isLoading = false;
          this.cdr.detectChanges();
        }
      });
  }
}